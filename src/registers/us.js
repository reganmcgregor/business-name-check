import { readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from '../http.js';
import { classify, nameKey, normalise } from '../match.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RANK = { exact: 0, close: 1, related: 2 };

/** SEC company list (SEC-registered companies only). Cached for a day. */
async function loadSecCompanies(env) {
  const cache = join(process.env.BNC_CACHE_DIR ?? tmpdir(), 'business-name-check-sec-company-tickers.json');
  try {
    const info = await stat(cache);
    if (Date.now() - info.mtimeMs < DAY_MS) return JSON.parse(await readFile(cache, 'utf8'));
  } catch { /* no cache yet */ }
  const res = await request('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'user-agent': env.SEC_USER_AGENT },
    timeoutMs: 30000,
  });
  const data = res.json();
  try { await writeFile(cache, res.text); } catch { /* cache is optional */ }
  return data;
}

export const secEdgar = {
  id: 'us-sec-edgar',
  country: 'US',
  kind: 'business',
  label: 'SEC EDGAR company list',
  env: ['SEC_USER_AGENT'],
  signup: 'https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data',
  coverage: 'Companies that file with the SEC (listed and large private issuers) only. Most US businesses are not on it.',
  // Local filter over a downloaded list, so it needs the name text, not a remote query.
  async search(name, env, { limit }) {
    const data = await loadSecCompanies(env);
    const words = nameKey(name).split(' ').filter(Boolean);
    const matches = Object.values(data)
      .filter((c) => {
        const t = ` ${normalise(c.title).replace(/ and /g, ' ')} `;
        return words.every((w) => t.includes(` ${w} `));
      })
      .map((c) => ({
        name: c.title,
        status: 'SEC registrant',
        active: true,
        type: c.ticker ? `Ticker ${c.ticker}` : undefined,
        id: String(c.cik_str),
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c.cik_str}`,
        details: { ticker: c.ticker },
      }));
    // Rank before trimming so an exact match is never cut by the limit.
    matches.sort((a, b) => RANK[classify(name, a.name)] - RANK[classify(name, b.name)]);
    return { total: matches.length, matches: matches.slice(0, Math.max(limit, 10)) };
  },
};

// US states and cities that publish their business register as open data, no key needed.
// Delaware, California, Florida and most other states do not, so they are manual links.
const DC_BASE = 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/FeatureServer';
const isoDate = (v) => (typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : v?.slice?.(0, 10));
const trim = (v) => (typeof v === 'string' ? v.trim() : v);
const TX_STATUS = { A: ['Active', true], R: ['Revoked', false], F: ['Forfeited', false] };

/** Upper-case alphanumeric words, safe to put inside a LIKE pattern. */
const likeWords = (name) => nameKey(name).split(' ').map((w) => w.toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean);
const socrataQ = (host, dataset) => ({ q, limit }) => {
  const url = new URL(`https://${host}/resource/${dataset}.json`);
  url.searchParams.set('$q', q);
  url.searchParams.set('$limit', String(Math.min(Math.max(limit, 5), 50)));
  return url.toString();
};
const arcgis = (layer, field, outFields) => ({ words }) => {
  const url = new URL(`${DC_BASE}/${layer}/query`);
  url.searchParams.set('where', words.map((w) => `UPPER(${field}) LIKE '%${w}%'`).join(' AND '));
  url.searchParams.set('outFields', outFields);
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '100');
  url.searchParams.set('f', 'json');
  return url.toString();
};

const SOURCES = [
  {
    state: 'NY', url: socrataQ('data.ny.gov', 'n9v6-gdp6'),
    map: (r) => ({ name: r.current_entity_name, id: r.dos_id, type: r.entity_type, status: 'Active entity', active: true, filed: r.initial_dos_filing_date }),
  },
  {
    state: 'CO', url: socrataQ('data.colorado.gov', '4ykn-tg5h'),
    map: (r) => ({ name: r.entityname, id: r.entityid, type: r.entitytype, status: r.entitystatus, active: !/dissol|withdrawn|expired|cancel|revoked|merged|inactive/i.test(r.entitystatus ?? ''), filed: r.entityformdate }),
  },
  {
    state: 'CT', url: socrataQ('data.ct.gov', 'n7gp-d28j'),
    map: (r) => ({ name: r.name, id: r.accountnumber, type: r.business_type, status: r.status, active: !/dissol|withdrawn|expired|cancel|revoked|merged|inactive|reservation/i.test(r.status ?? ''), filed: r.date_registration }),
  },
  {
    state: 'OR', url: socrataQ('data.oregon.gov', 'tckn-sxa6'),
    map: (r) => ({ name: r.business_name, id: r.registry_number, type: r.entity_type, status: 'Active business', active: true, filed: r.registry_date, url: r.business_details?.url }),
  },
  {
    // Active registrations only. $q would also match officer surnames, so filter on the business name.
    state: 'PA',
    url: ({ words, limit }) => {
      const url = new URL('https://data.pa.gov/resource/xvd7-5r2c.json');
      url.searchParams.set('$where', words.map((w) => `upper(business_name) like '%${w}%'`).join(' AND '));
      url.searchParams.set('$select', 'distinct business_name,filing_number,typeofbusinessregistration,creationdate');
      url.searchParams.set('$limit', String(Math.min(Math.max(limit, 5), 100)));
      return url.toString();
    },
    map: (r) => ({ name: r.business_name, id: r.filing_number, type: r.typeofbusinessregistration, status: 'Active registration', active: true, filed: r.creationdate }),
  },
  {
    state: 'DC', source: 'DC Department of Licensing and Consumer Protection',
    url: arcgis(0, 'BUSINESS_NAME', 'FILE_NUMBER,BUSINESS_NAME,ENTITY_STATUS,MODELTYPE,EFFECTIVE_DATE'),
    rows: (j) => j.features?.map((f) => f.attributes) ?? [],
    map: (r) => ({ name: r.BUSINESS_NAME, id: r.FILE_NUMBER, type: r.MODELTYPE, status: r.ENTITY_STATUS, active: /^active/i.test(r.ENTITY_STATUS ?? ''), filed: isoDate(r.EFFECTIVE_DATE) }),
  },
  {
    state: 'DC', source: 'DC trade names',
    url: arcgis(1, 'TRADE_NAME', 'FILE_NUMBER,TRADE_NAME,TRADENAME_STATUS,EFFECTIVE_DATE,TRADENAME_EXPIRATIONDATE'),
    rows: (j) => j.features?.map((f) => f.attributes) ?? [],
    map: (r) => ({
      name: r.TRADE_NAME, id: r.FILE_NUMBER, type: 'Trade name', status: r.TRADENAME_STATUS,
      active: /^active/i.test(r.TRADENAME_STATUS ?? '') && !(r.TRADENAME_EXPIRATIONDATE && r.TRADENAME_EXPIRATIONDATE < Date.now()),
      filed: isoDate(r.EFFECTIVE_DATE),
    }),
  },
  {
    // Entities with a Texas Comptroller franchise-tax account. Not the full Secretary of State register:
    // sole proprietors, most general partnerships and assumed names are missing.
    state: 'TX', source: 'Texas Comptroller franchise tax',
    url: socrataQ('data.texas.gov', '9cir-efmm'),
    map: (r) => {
      const code = trim(r.sos_status_code);
      const [label, active] = TX_STATUS[code] ?? [code ? `SOS status ${code}` : 'Status not given', null];
      return { name: trim(r.taxpayer_name), id: trim(r.secretary_of_state_sos_or_coa_file_number), type: `Franchise tax account (${trim(r.taxpayer_organizational_type) ?? 'type not given'})`, status: label, active, filed: r.sos_charter_date };
    },
  },
  {
    // Retail outlets with a sales tax permit. Adds trade names, but only for businesses that sell taxable goods.
    state: 'TX', source: 'Texas Comptroller sales tax permits',
    url: socrataQ('data.texas.gov', 'jrea-zgmq'),
    map: (r) => ({ name: trim(r.outlet_name) || trim(r.taxpayer_name), id: trim(r.taxpayer_number), type: 'Sales tax permit outlet', status: 'Active permit', active: true, filed: r.outlet_permit_issue_date }),
  },
];

const STATE_LIST = [...new Set(SOURCES.map((s) => s.state))];

export const usStateOpenData = {
  id: 'us-state-open-data',
  country: 'US',
  kind: 'business',
  label: `US state open data (${STATE_LIST.join(', ')})`,
  env: [],
  coverage: 'Seven US jurisdictions that publish business data as open data. Texas covers franchise-tax and sales-tax accounts only, not the full Secretary of State register. Delaware, California and Florida, among others, are not covered.',
  async search(name, env, { limit }) {
    const q = nameKey(name).split(' ').filter(Boolean).join(' ');
    const words = likeWords(name);
    if (!words.length) return { total: 0, matches: [] };
    const headers = env.SOCRATA_APP_TOKEN ? { 'X-App-Token': env.SOCRATA_APP_TOKEN } : {};
    const jobs = SOURCES.map(async (s) => {
      const res = await request(s.url({ q, words, limit }), { headers: s.state === 'DC' ? {} : headers });
      const json = res.json();
      if (json.error) throw new Error(json.error.message ?? 'Register returned an error');
      const rows = s.rows ? s.rows(json) : json;
      return rows.map((r) => {
        const m = s.map(r);
        return { ...m, url: m.url ?? null, details: { state: s.state, source: s.source, filed: m.filed } };
      });
    });
    const settled = await Promise.allSettled(jobs);
    if (settled.every((r) => r.status === 'rejected')) throw settled[0].reason;
    const seen = new Set();
    const matches = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      .filter((m) => m.name)
      .filter((m) => { const k = `${m.details.state}|${m.details.source}|${m.id}|${m.name}`; return seen.has(k) ? false : seen.add(k); });
    matches.sort((a, b) => RANK[classify(name, a.name)] - RANK[classify(name, b.name)]);
    const failed = [...new Set(settled.map((r, i) => (r.status === 'rejected' ? SOURCES[i].source ?? SOURCES[i].state : null)).filter(Boolean))];
    return {
      total: matches.length,
      matches,
      note: failed.length ? `Could not reach: ${failed.join(', ')}.` : undefined,
    };
  },
};

// Hand-check links for states with no open API. Only Florida accepts a pre-filled name in the URL
// (checked in a browser); the rest are landing pages where you type the name yourself. Several of
// these sites sit behind bot protection or a captcha, so they are for people, not for scripts.
export const usManual = [
  { label: 'USPTO trademark search (no open search API)', url: () => 'https://tmsearch.uspto.gov/search/search-information' },
  { label: 'Florida Sunbiz entity name search (results page)', url: (name) => `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults/EntityName/${encodeURIComponent(String(name).trim())}/Page1` },
  { label: 'California business search (type the name)', url: () => 'https://bizfileonline.sos.ca.gov/search/business' },
  { label: 'Delaware entity name search (captcha, type the name)', url: () => 'https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx' },
  { label: 'Washington business search (type the name)', url: () => 'https://ccfs.sos.wa.gov/' },
  { label: 'Arizona entity search (type the name)', url: () => 'https://arizonabusinesscenter.azcc.gov/EntitySearch/Index' },
  { label: 'Nevada entity search (type the name)', url: () => 'https://esos.nv.gov/EntitySearch/OnlineEntitySearch' },
  { label: 'Georgia business search (type the name)', url: () => 'https://ecorp.sos.ga.gov/BusinessSearch' },
  { label: 'Illinois business entity search (type the name)', url: () => 'https://apps.ilsos.gov/businessentitysearch/' },
  { label: 'North Carolina business search (type the name)', url: () => 'https://www.sosnc.gov/online_services/search/by_title/_Business_Registration' },
  { label: 'Ohio business search (type the name)', url: () => 'https://businesssearch.ohiosos.gov/' },
  { label: 'Michigan business search (type the name)', url: () => 'https://mibusinessregistry.lara.state.mi.us/search/business' },
  { label: 'New Jersey business name search (type the name)', url: () => 'https://www.njportal.com/DOR/BusinessNameSearch/Search/BusinessName' },
  { label: 'Massachusetts corporations search (type the name)', url: () => 'https://corp.sec.state.ma.us/corpweb/CorpSearch/CorpSearch.aspx' },
  { label: 'Virginia entity search (type the name)', url: () => 'https://cis.scc.virginia.gov/EntitySearch/Index' },
  { label: 'Other states: directory of every state register (NASS)', url: () => 'https://www.nass.org/business-services/corporate-registration' },
];
