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

// US states that publish their business register as open data (Socrata), no key needed.
// Delaware, California, Texas, Florida and most others do not, so they are manual links.
const STATES = [
  {
    state: 'NY', host: 'data.ny.gov', dataset: 'n9v6-gdp6',
    map: (r) => ({ name: r.current_entity_name, id: r.dos_id, type: r.entity_type, status: 'Active entity', active: true, filed: r.initial_dos_filing_date }),
  },
  {
    state: 'CO', host: 'data.colorado.gov', dataset: '4ykn-tg5h',
    map: (r) => ({ name: r.entityname, id: r.entityid, type: r.entitytype, status: r.entitystatus, active: !/dissol|withdrawn|expired|cancel|revoked|merged|inactive/i.test(r.entitystatus ?? ''), filed: r.entityformdate }),
  },
  {
    state: 'CT', host: 'data.ct.gov', dataset: 'n7gp-d28j',
    map: (r) => ({ name: r.name, id: r.accountnumber, type: r.business_type, status: r.status, active: !/dissol|withdrawn|expired|cancel|revoked|merged|inactive|reservation/i.test(r.status ?? ''), filed: r.date_registration }),
  },
  {
    state: 'OR', host: 'data.oregon.gov', dataset: 'tckn-sxa6',
    map: (r) => ({ name: r.business_name, id: r.registry_number, type: r.entity_type, status: 'Active business', active: true, filed: r.registry_date, url: r.business_details?.url }),
  },
];

export const usStateOpenData = {
  id: 'us-state-open-data',
  country: 'US',
  kind: 'business',
  label: 'US state open data (NY, CO, CT, OR only)',
  env: [],
  coverage: 'Four states that publish their business register as open data. Other states, including Delaware, California, Texas and Florida, are not covered.',
  async search(name, env, { limit }) {
    const q = nameKey(name).split(' ').filter(Boolean).join(' ');
    const jobs = STATES.map(async (s) => {
      const url = new URL(`https://${s.host}/resource/${s.dataset}.json`);
      url.searchParams.set('$q', q);
      url.searchParams.set('$limit', String(Math.min(Math.max(limit, 5), 50)));
      const headers = env.SOCRATA_APP_TOKEN ? { 'X-App-Token': env.SOCRATA_APP_TOKEN } : {};
      const rows = (await request(url.toString(), { headers })).json();
      return rows.map((r) => {
        const m = s.map(r);
        return { ...m, url: m.url ?? null, details: { state: s.state, filed: m.filed } };
      });
    });
    const settled = await Promise.allSettled(jobs);
    if (settled.every((r) => r.status === 'rejected')) throw settled[0].reason;
    const matches = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).filter((m) => m.name);
    matches.sort((a, b) => RANK[classify(name, a.name)] - RANK[classify(name, b.name)]);
    const failed = settled.map((r, i) => (r.status === 'rejected' ? STATES[i].state : null)).filter(Boolean);
    return {
      total: matches.length,
      matches,
      note: failed.length ? `Could not reach: ${failed.join(', ')}.` : undefined,
    };
  },
};

export const usManual = [
  { label: 'USPTO trademark search (no open search API)', url: () => 'https://tmsearch.uspto.gov/search/search-information' },
  { label: 'Delaware entity name search (captcha-protected)', url: () => 'https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx' },
  { label: 'State business register directory (NASS)', url: () => 'https://www.nass.org/business-services/corporate-registration' },
];
