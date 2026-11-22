// Register adapters against canned responses (no network, no keys).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkName, exitCodeFor, parseCountries } from '../src/index.js';
import { parseJsonp } from '../src/registers/au.js';

process.env.BNC_MIN_DELAY_MS = '0';
process.env.BNC_CACHE_DIR = mkdtempSync(join(tmpdir(), 'bnc-test-'));
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
  const r = await checkName('Acme', { countries: ['UK', 'NZ'], env: {} , domains: false });
  assert.ok(r.results.every((x) => x.status === 'skipped'));
  assert.match(r.results[0].reason, /COMPANIES_HOUSE_API_KEY/);
  assert.equal(calls.length, 0);
});

test('Companies House: basic auth, mapping, classification', async () => {
  stubFetch(() => json({ total_results: 2, items: [
    { title: 'TESCO PLC', company_status: 'active', company_type: 'plc', company_number: '00445790' },
    { title: 'TESCO STORES LIMITED', company_status: 'active', company_type: 'ltd', company_number: '00519500' },
  ] }));
  const r = await checkName('Tesco', { countries: ['UK'], env: { COMPANIES_HOUSE_API_KEY: 'k' } , domains: false });
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
  const r = await checkName('Fonterra', { countries: ['NZ'], env: { NZBN_SUBSCRIPTION_KEY: 'k' } , domains: false });
  assert.equal(r.results[0].matches[0].id, '9429000000000');
  assert.equal(r.results[0].matches[0].match, 'close');
  assert.equal(calls[0].init.headers['Ocp-Apim-Subscription-Key'], 'k');
  assert.match(calls[0].url, /search-term=Fonterra/);
});

test('ABN Lookup: JSONP and API errors', async () => {
  stubFetch(() => new Response('callback({"Names":[{"Abn":"88000014675","Name":"WOOLWORTHS GROUP LIMITED","NameType":"Entity Name","AbnStatus":"0000000001","IsCurrent":true,"State":"NSW","Postcode":"2000","Score":100}]})'));
  const ok = await checkName('Woolworths', { countries: ['AU'], env: { ABR_GUID: 'g' } , domains: false });
  const abr = ok.results.find((x) => x.id === 'au-abr');
  assert.equal(abr.status, 'ok');
  assert.equal(abr.matches[0].status, 'Current name');
  assert.equal(abr.matches[0].url, 'https://abr.business.gov.au/ABN/View?abn=88000014675');

  stubFetch(() => new Response('callback({"Message":"The GUID entered is not recognised as a Registered Party","Names":[]})'));
  const bad = await checkName('Woolworths', { countries: ['AU'], env: { ABR_GUID: 'x' } , domains: false });
  assert.equal(bad.results.find((x) => x.id === 'au-abr').status, 'error');
});

test('retries on 429 then succeeds', async () => {
  let n = 0;
  stubFetch(() => (++n === 1 ? new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }) : json({ total_results: 0, items: [] })));
  const r = await checkName('Zzzz', { countries: ['UK'], env: { COMPANIES_HOUSE_API_KEY: 'k' } , domains: false });
  assert.equal(r.results[0].status, 'ok');
  assert.equal(n, 2);
});

test('401 is reported as rejected credentials, not a crash', async () => {
  stubFetch(() => json({ error: 'nope' }, 401));
  const r = await checkName('Tesco', { countries: ['UK'], env: { COMPANIES_HOUSE_API_KEY: 'bad' } , domains: false });
  assert.equal(r.results[0].status, 'error');
  assert.match(r.results[0].reason, /credentials/);
});

test('IP Australia: token, quick search, detail fetch', async () => {
  stubFetch((url) => {
    if (url.endsWith('/access_token')) return json({ access_token: 'tok' });
    if (url.endsWith('/search/quick')) return json({ count: 1, trademarkIds: ['1234567'] });
    return json({ words: ['WOOLWORTHS'], statusCode: 'Registered', kind: ['Word'], owner: [{ name: 'Example Pty Ltd' }], goodsAndServices: [{ class: '35' }] });
  });
  const r = await checkName('Woolworths', { countries: ['AU'], env: { IPA_CLIENT_ID: 'i', IPA_CLIENT_SECRET: 's' } , domains: false });
  const ipa = r.results.find((x) => x.id === 'au-ip-australia');
  assert.equal(ipa.status, 'ok');
  assert.equal(ipa.matches[0].match, 'exact');
  assert.equal(ipa.matches[0].status, 'Registered');
  assert.equal(ipa.matches[0].url, 'https://search.ipaustralia.gov.au/trademarks/search/view/1234567');
  const searchCall = calls.find((c) => c.url.endsWith('/search/quick'));
  assert.deepEqual(JSON.parse(searchCall.init.body).filters.status, ['REGISTERED', 'PENDING']);
});

test('summary never reports a clean result when nothing was checked', async () => {
  stubFetch(() => { throw new Error('no network expected'); });
  const r = await checkName('Acme', { countries: ['UK'], env: {}, domains: false });
  assert.equal(r.summary.UK.registersChecked, 0);
  assert.equal(r.summary.UK.complete, false);
  assert.equal(r.summary.UK.tradeMarksChecked, false);
});

test('inactive exact matches are counted apart and do not trigger the exit code', async () => {
  stubFetch(() => json({ total_results: 1, items: [
    { title: 'ACME LIMITED', company_status: 'dissolved', company_type: 'ltd', company_number: '1' },
  ] }));
  const r = await checkName('Acme', { countries: ['UK'], env: { COMPANIES_HOUSE_API_KEY: 'k' }, domains: false });
  assert.equal(r.summary.UK.exact, 0);
  assert.equal(r.summary.UK.inactiveExact, 1);
  assert.equal(exitCodeFor(r), 0);

  stubFetch(() => json({ total_results: 1, items: [
    { title: 'ACME LIMITED', company_status: 'active', company_type: 'ltd', company_number: '1' },
  ] }));
  const live = await checkName('Acme', { countries: ['UK'], env: { COMPANIES_HOUSE_API_KEY: 'k' }, domains: false });
  assert.equal(exitCodeFor(live), 1);
});

test('exit code 3 when a register fails and nothing else was found', async () => {
  stubFetch(() => json({ error: 'nope' }, 401));
  const r = await checkName('Acme', { countries: ['UK'], env: { COMPANIES_HOUSE_API_KEY: 'bad' }, domains: false });
  assert.equal(exitCodeFor(r), 3);
});

test('US state open data merges states and flags dissolved records', async () => {
  stubFetch((url) => {
    if (url.includes('data.ny.gov')) return json([{ current_entity_name: 'HEAT & CHILL MECHANICAL LLC', dos_id: '1', entity_type: 'LLC' }]);
    if (url.includes('data.colorado.gov')) return json([{ entityname: 'Heat & Chill Pros LLC', entityid: '2', entitystatus: 'Voluntarily Dissolved' }]);
    return json([]);
  });
  const r = await checkName('Heat & Chill', { countries: ['US'], env: {}, domains: false });
  const st = r.results.find((x) => x.id === 'us-state-open-data');
  assert.equal(st.status, 'ok');
  const co = st.matches.find((m) => m.details.state === 'CO');
  assert.equal(co.active, false);
  assert.equal(st.matches.find((m) => m.details.state === 'NY').active, true);
});

test('SEC filter finds "Heat Chill" for "Heat & Chill" and ranks exact first', async () => {
  const { secEdgar } = await import('../src/registers/us.js');
  stubFetch(() => json({ 0: { cik_str: 1, ticker: 'HCI', title: 'HEAT CHILL INC' }, 1: { cik_str: 2, ticker: 'HCX', title: 'ARTISAN HEAT CHILL SYSTEMS CORP' } }));
  const out = await secEdgar.search('Heat & Chill', { SEC_USER_AGENT: 'test', }, { limit: 10 }).catch((e) => e);
  assert.ok(out.matches, String(out));
  assert.equal(out.matches[0].name, 'HEAT CHILL INC');
  assert.equal(out.matches.length, 2);
});

test('DC, PA and Texas sources: LIKE filters, statuses, dates and dedupe', async () => {
  stubFetch((url) => {
    if (url.includes('FeatureServer/0/query')) {
      return json({ features: [
        { attributes: { BUSINESS_NAME: 'HEAT & CHILL LLC', FILE_NUMBER: 'L1', ENTITY_STATUS: 'Active - In Good Standing', MODELTYPE: 'Domestic LLC', EFFECTIVE_DATE: -86400000 } },
        { attributes: { BUSINESS_NAME: 'HEAT & CHILL INC', FILE_NUMBER: 'L2', ENTITY_STATUS: 'Revoked', MODELTYPE: 'Domestic Corporation', EFFECTIVE_DATE: 1700000000000 } },
      ] });
    }
    if (url.includes('FeatureServer/1/query')) {
      return json({ features: [
        { attributes: { TRADE_NAME: 'Heat & Chill', FILE_NUMBER: 'T1', TRADENAME_STATUS: 'Active Trade Name', EFFECTIVE_DATE: 1700000000000, TRADENAME_EXPIRATIONDATE: Date.now() - 1000 } },
      ] });
    }
    if (url.includes('data.pa.gov')) {
      return json([
        { business_name: 'Heat & Chill Pty', filing_number: '0001', typeofbusinessregistration: 'Domestic LLC', creationdate: '2020-01-02T00:00:00.000' },
        { business_name: 'Heat & Chill Pty', filing_number: '0001', typeofbusinessregistration: 'Domestic LLC', creationdate: '2020-01-02T00:00:00.000' },
      ]);
    }
    if (url.includes('9cir-efmm')) return json([{ taxpayer_name: 'HEAT & CHILL SERVICES LLC ', sos_status_code: 'R ', secretary_of_state_sos_or_coa_file_number: '0800', taxpayer_organizational_type: 'CL' }]);
    if (url.includes('jrea-zgmq')) return json([{ outlet_name: 'HEAT & CHILL #1', taxpayer_number: '320', outlet_permit_issue_date: '2022-04-06T00:00:00.000' }]);
    return json([]);
  });
  const r = await checkName("Heat & Chill", { countries: ['US'], env: {}, domains: false });
  const st = r.results.find((x) => x.id === 'us-state-open-data');
  assert.equal(st.status, 'ok');

  const dcCall = calls.find((c) => c.url.includes('FeatureServer/0/query'));
  const where = new URL(dcCall.url).searchParams.get('where');
  assert.equal(where, "UPPER(BUSINESS_NAME) LIKE '%HEAT%' AND UPPER(BUSINESS_NAME) LIKE '%CHILL%'");
  assert.ok(!calls.find((c) => c.url.includes('maps2.dcgis') && c.init?.headers?.['X-App-Token']));

  const dc = st.matches.filter((m) => m.details.state === 'DC' && m.type !== 'Trade name');
  assert.equal(dc.find((m) => m.id === 'L1').active, true);
  assert.equal(dc.find((m) => m.id === 'L1').details.filed, '1969-12-31');
  assert.equal(dc.find((m) => m.id === 'L2').active, false);
  assert.equal(st.matches.find((m) => m.type === 'Trade name').active, false, 'expired trade name is inactive');

  assert.equal(st.matches.filter((m) => m.details.state === 'PA').length, 1, 'duplicates collapse');
  const tx = st.matches.filter((m) => m.details.state === 'TX');
  const fran = tx.find((m) => m.id === '0800');
  assert.equal(fran.name, 'HEAT & CHILL SERVICES LLC');
  assert.equal(fran.status, 'Revoked');
  assert.equal(fran.active, false);
  assert.equal(tx.find((m) => m.type === 'Sales tax permit outlet').active, true);
});

test('US open data is safe with odd input and reports an unreachable source', async () => {
  stubFetch((url) => (url.includes('data.pa.gov') ? json({ error: true }, 500) : json([])));
  const r = await checkName("O'Brien's; DROP", { countries: ['US'], env: {}, domains: false });
  const st = r.results.find((x) => x.id === 'us-state-open-data');
  assert.equal(st.status, 'ok');
  assert.match(st.note, /PA/);
  const paCall = calls.find((c) => c.url.includes('data.pa.gov'));
  const where = new URL(paCall.url).searchParams.get('$where');
  assert.ok(!where.includes("'; "), 'quotes and punctuation are stripped from LIKE words');
});

test('US hand-check links: Florida is pre-filled and encoded, the rest are landing pages', async () => {
  const { usManual } = await import('../src/registers/us.js');
  const fl = usManual.find((m) => /Florida/.test(m.label));
  assert.equal(fl.url(' Heat & Chill '), 'https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults/EntityName/Heat%20%26%20Chill/Page1');
  for (const m of usManual) assert.match(m.url('x'), /^https:\/\//, m.label);
});
