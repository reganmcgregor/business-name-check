import { readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from '../http.js';
import { normalise } from '../match.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** SEC company list (SEC-registered companies only). Cached for a day. */
async function loadSecCompanies(env) {
  const cache = join(tmpdir(), 'business-name-check-sec-company-tickers.json');
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
    const q = normalise(name);
    const words = q.split(' ').filter(Boolean);
    const hits = Object.values(data).filter((c) => {
      const t = ` ${normalise(c.title)} `;
      return words.every((w) => t.includes(` ${w} `) || t.includes(` ${w}`));
    });
    return {
      total: hits.length,
      matches: hits.slice(0, Math.max(limit, 10)).map((c) => ({
        name: c.title,
        status: 'SEC registrant',
        type: c.ticker ? `Ticker ${c.ticker}` : undefined,
        id: String(c.cik_str),
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c.cik_str}`,
        details: { ticker: c.ticker },
      })),
    };
  },
};

export const usManual = [
  { label: 'USPTO trademark search (no open search API)', url: () => 'https://tmsearch.uspto.gov/search/search-information' },
  { label: 'Delaware entity name search (captcha-protected)', url: () => 'https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx' },
  { label: 'State business register directory (NASS)', url: () => 'https://www.nass.org/business-services/corporate-registration' },
];
