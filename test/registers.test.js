// Register adapters against canned responses (no network, no keys).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkName, parseCountries } from '../src/index.js';
import { parseJsonp } from '../src/registers/au.js';

process.env.BNC_MIN_DELAY_MS = '0';
const realFetch = globalThis.fetch;
let calls;

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

function stubFetch(handler) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
}
beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

test('parseJsonp unwraps ABN Lookup callbacks', () => {
  assert.deepEqual(parseJsonp('callback({"Names":[]})'), { Names: [] });
});

test('parseCountries', () => {
  assert.deepEqual(parseCountries('au, GB'), ['AU', 'UK']);
  assert.equal(parseCountries('all').length, 4);
  assert.throws(() => parseCountries('fr'));
});

test('registers without a key skip themselves', async () => {
  stubFetch(() => { throw new Error('no network expected'); });
  const r = await checkName('Acme', { countries: ['UK', 'NZ'], env: {} });
  assert.ok(r.results.every((x) => x.status === 'skipped'));
  assert.match(r.results[0].reason, /COMPANIES_HOUSE_API_KEY/);
  assert.equal(calls.length, 0);
});

test('Companies House: basic auth, mapping, classification', async () => {
  stubFetch(() => json({ total_results: 2, items: [
    { title: 'TESCO PLC', company_status: 'active', company_type: 'plc', company_number: '00445790' },
    { title: 'TESCO STORES LIMITED', company_status: 'active', company_type: 'ltd', company_number: '00519500' },
  ] }));
  const r = await checkName('Tesco', { countries: ['UK'], env: { COMPANIES_HOUSE_API_KEY: 'k' } });
  const ch = r.results[0];
  assert.equal(ch.status, 'ok');
  assert.equal(ch.matches[0].match, 'exact');
  assert.equal(ch.matches[0].url, 'https://find-and-update.company-information.service.gov.uk/company/00445790');
  assert.equal(calls[0].init.headers.authorization, `Basic ${Buffer.from('k:').toString('base64')}`);
});

test('NZBN: subscription key header and mapping', async () => {
  stubFetch(() => json({ totalItems: 1, items: [
    { nzbn: '9429000000000', entityName: 'FONTERRA CO-OPERATIVE GROUP LIMITED', entityStatusDescription: 'Registered', entityTypeDescription: 'NZ Limited Company' },
  ] }));
  const r = await checkName('Fonterra', { countries: ['NZ'], env: { NZBN_SUBSCRIPTION_KEY: 'k' } });
  assert.equal(r.results[0].matches[0].id, '9429000000000');
  assert.equal(r.results[0].matches[0].match, 'close');
  assert.equal(calls[0].init.headers['Ocp-Apim-Subscription-Key'], 'k');
  assert.match(calls[0].url, /search-term=Fonterra/);
});

test('ABN Lookup: JSONP and API errors', async () => {
  stubFetch(() => new Response('callback({"Names":[{"Abn":"88000014675","Name":"WOOLWORTHS GROUP LIMITED","NameType":"Entity Name","AbnStatus":"0000000001","IsCurrent":true,"State":"NSW","Postcode":"2000","Score":100}]})'));
  const ok = await checkName('Woolworths', { countries: ['AU'], env: { ABR_GUID: 'g' } });
  const abr = ok.results.find((x) => x.id === 'au-abr');
  assert.equal(abr.status, 'ok');
  assert.equal(abr.matches[0].status, 'Current name');
  assert.equal(abr.matches[0].url, 'https://abr.business.gov.au/ABN/View?abn=88000014675');

  stubFetch(() => new Response('callback({"Message":"The GUID entered is not recognised as a Registered Party","Names":[]})'));
  const bad = await checkName('Woolworths', { countries: ['AU'], env: { ABR_GUID: 'x' } });
  assert.equal(bad.results.find((x) => x.id === 'au-abr').status, 'error');
});

test('retries on 429 then succeeds', async () => {
  let n = 0;
  stubFetch(() => (++n === 1 ? new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }) : json({ total_results: 0, items: [] })));
  const r = await checkName('Zzzz', { countries: ['UK'], env: { COMPANIES_HOUSE_API_KEY: 'k' } });
  assert.equal(r.results[0].status, 'ok');
  assert.equal(n, 2);
});

test('401 is reported as rejected credentials, not a crash', async () => {
  stubFetch(() => json({ error: 'nope' }, 401));
  const r = await checkName('Tesco', { countries: ['UK'], env: { COMPANIES_HOUSE_API_KEY: 'bad' } });
  assert.equal(r.results[0].status, 'error');
  assert.match(r.results[0].reason, /credentials/);
});

test('IP Australia: token, quick search, detail fetch', async () => {
  stubFetch((url) => {
    if (url.endsWith('/access_token')) return json({ access_token: 'tok' });
    if (url.endsWith('/search/quick')) return json({ count: 1, trademarkIds: ['1234567'] });
    return json({ words: ['WOOLWORTHS'], statusCode: 'Registered', kind: ['Word'], owner: [{ name: 'Example Pty Ltd' }], goodsAndServices: [{ class: '35' }] });
  });
  const r = await checkName('Woolworths', { countries: ['AU'], env: { IPA_CLIENT_ID: 'i', IPA_CLIENT_SECRET: 's' } });
  const ipa = r.results.find((x) => x.id === 'au-ip-australia');
  assert.equal(ipa.status, 'ok');
  assert.equal(ipa.matches[0].match, 'exact');
  assert.equal(ipa.matches[0].status, 'Registered');
  assert.equal(ipa.matches[0].url, 'https://search.ipaustralia.gov.au/trademarks/search/view/1234567');
  const searchCall = calls.find((c) => c.url.endsWith('/search/quick'));
  assert.deepEqual(JSON.parse(searchCall.init.body).filters.status, ['REGISTERED', 'PENDING']);
});
