import { request } from '../http.js';
import { classify, normalise } from '../match.js';

const RANK_ORDER = { exact: 0, close: 1, related: 2 };
const IPA_MIN_DETAILS = 60;

const CKAN = 'https://data.gov.au/data/api/3/action/datastore_search';
const BUSINESS_NAMES_RESOURCE = '55ad4b1c-5eeb-44ea-8b29-d410da431be3';
const COMPANIES_RESOURCE = '5c3914e6-413e-4a2c-b890-bf8efe3eabf2';

const abrUrl = (abn) => (abn ? `https://abr.business.gov.au/ABN/View?abn=${abn}` : null);

/** Words only, so "Heat & Chill" becomes "heat chill" for the CKAN full-text query. */
function ftsQuery(name) {
  return normalise(name).replace(/\band\b/g, ' ').trim().replace(/\s+/g, ' ');
}

/** Exact-name filters: CKAN filters are case-sensitive and ASIC stores names upper case. */
function exactVariants(name) {
  const upper = String(name).trim().toUpperCase().replace(/\s+/g, ' ');
  const variants = new Set([upper, upper.replace(/&/g, 'AND'), upper.replace(/\bAND\b/g, '&')]);
  return [...variants];
}

async function ckan(resourceId, params) {
  const url = new URL(CKAN);
  url.searchParams.set('resource_id', resourceId);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await request(url.toString(), { timeoutMs: 45000 });
  const body = res.json();
  if (!body.success) throw new Error('data.gov.au returned success=false');
  return body.result;
}

async function ckanSearch(resourceId, nameField, name, limit) {
  const seen = new Map();
  const q = ftsQuery(name);
  const jobs = [];
  if (q) jobs.push(ckan(resourceId, { q, limit: String(limit) }));
  for (const v of exactVariants(name)) {
    jobs.push(ckan(resourceId, { filters: JSON.stringify({ [nameField]: v }), limit: '10' }));
  }
  // Same host, so http.js spaces these out one at a time.
  const results = await Promise.all(jobs);
  let total = 0;
  for (const r of results) {
    if (r.q) total = r.total ?? 0;
    for (const rec of r.records) seen.set(rec._id, rec);
  }
  return { records: [...seen.values()], total };
}

export const asicBusinessNames = {
  id: 'au-asic-business-names',
  country: 'AU',
  kind: 'business',
  label: 'ASIC business names register (via data.gov.au)',
  env: [],
  coverage: 'Registered business names across all states and territories.',
  async search(name, _env, { limit }) {
    const { records, total } = await ckanSearch(BUSINESS_NAMES_RESOURCE, 'BN_NAME', name, limit);
    return {
      total,
      matches: records.map((r) => ({
        name: r.BN_NAME,
        status: r.BN_STATUS,
        active: r.BN_STATUS === 'Registered',
        type: 'Business name',
        id: r.BN_STATE_NUM ?? r.BN_ABN ?? null,
        url: abrUrl(r.BN_ABN),
        details: { registered: r.BN_REG_DT, cancelled: r.BN_CANCEL_DT, state: r.BN_STATE_OF_REG, abn: r.BN_ABN },
      })),
    };
  },
};

export const asicCompanies = {
  id: 'au-asic-companies',
  country: 'AU',
  kind: 'business',
  label: 'ASIC company register (via data.gov.au)',
  env: [],
  coverage: 'Companies registered under the Corporations Act (current and former names).',
  async search(name, _env, { limit }) {
    const { records, total } = await ckanSearch(COMPANIES_RESOURCE, 'Company Name', name, limit);
    return {
      total,
      matches: records.map((r) => ({
        name: r['Company Name'],
        status: r.Status,
        active: r.Status === 'REGD',
        type: r.Type,
        id: r.ACN,
        url: abrUrl(r.ABN),
        details: { registered: r['Date of Registration'], deregistered: r['Date of Deregistration'], acn: r.ACN, abn: r.ABN, currentName: r['Current Name'] },
      })),
    };
  },
};

/** ABN Lookup returns JSONP: callback({...}). */
export function parseJsonp(text) {
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start === -1 || end === -1) throw new Error('Unexpected ABN Lookup response');
  return JSON.parse(text.slice(start + 1, end));
}

export const abr = {
  id: 'au-abr',
  country: 'AU',
  kind: 'business',
  label: 'ABN Lookup (Australian Business Register)',
  env: ['ABR_GUID'],
  signup: 'https://abr.business.gov.au/Tools/WebServices',
  coverage: 'Entity names, business names and trading names linked to an ABN.',
  async search(name, env, { limit }) {
    const url = new URL('https://abr.business.gov.au/json/MatchingNames.aspx');
    url.searchParams.set('name', name);
    url.searchParams.set('maxResults', String(Math.min(Math.max(limit, 1), 200)));
    url.searchParams.set('guid', env.ABR_GUID);
    const res = await request(url.toString(), { headers: { accept: '*/*' } });
    const body = parseJsonp(res.text);
    if (body.Message) throw new Error(`ABN Lookup: ${body.Message}`);
    return {
      total: (body.Names ?? []).length,
      matches: (body.Names ?? []).map((n) => ({
        name: n.Name,
        status: n.IsCurrent ? 'Current name' : 'Former name',
        active: Boolean(n.IsCurrent),
        type: n.NameType,
        id: n.Abn,
        url: abrUrl(n.Abn),
        details: { state: n.State, postcode: n.Postcode, score: n.Score, abnStatusCode: n.AbnStatus },
      })),
    };
  },
};

/** IP Australia Australian Trade Mark Search API (OAuth client credentials). */
export const ipAustralia = {
  id: 'au-ip-australia',
  country: 'AU',
  kind: 'trademark',
  label: 'IP Australia trade marks',
  env: ['IPA_CLIENT_ID', 'IPA_CLIENT_SECRET'],
  signup: 'https://portal.api.ipaustralia.gov.au/s/',
  coverage: 'Registered and pending Australian trade marks (word marks).',
  async search(name, env, { limit }) {
    const base = (env.IPA_ENV ?? 'production') === 'test'
      ? 'https://test.api.ipaustralia.gov.au/public'
      : 'https://production.api.ipaustralia.gov.au/public';
    const tokenRes = await request(`${base}/external-token-api/v1/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.IPA_CLIENT_ID,
        client_secret: env.IPA_CLIENT_SECRET,
      }).toString(),
    });
    const token = tokenRes.json().access_token;
    if (!token) throw new Error('IP Australia returned no access token');
    const auth = { authorization: `Bearer ${token}` };
    const api = `${base}/australian-trade-mark-search-api/v1`;

    // Live marks only (registered or pending). Removed and lapsed marks are left out.
    const searchRes = await request(`${api}/search/quick`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: name,
        sort: { field: 'NUMBER', direction: 'ASCENDING' },
        filters: { quickSearchType: ['WORD'], status: ['REGISTERED', 'PENDING'] },
      }),
    });
    const body = searchRes.json();
    const allIds = extractIds(body);
    // Search returns numbers only, so each record is one more call. Newest first, capped to stay polite.
    const cap = Math.max(limit, IPA_MIN_DETAILS);
    const ids = [...allIds].reverse().slice(0, cap);

    const matches = [];
    for (const id of ids) {
      const detail = (await request(`${api}/trade-mark/${encodeURIComponent(id)}`, { headers: auth })).json();
      const words = Array.isArray(detail.words) ? detail.words.filter(Boolean) : [];
      const best = [...words].sort((a, b) => RANK_ORDER[classify(name, a)] - RANK_ORDER[classify(name, b)])[0];
      matches.push({
        name: best ?? extractWords(detail) ?? `Trade mark ${id}`,
        status: detail.statusCode ?? detail.statusGroup,
        active: true, // the search is limited to registered and pending marks
        type: Array.isArray(detail.kind) ? detail.kind.join(', ') : 'Trade mark',
        id: String(id),
        url: `https://search.ipaustralia.gov.au/trademarks/search/view/${id}`,
        details: {
          words,
          owner: (detail.owner ?? []).map((o) => o.name).filter(Boolean),
          classes: (detail.goodsAndServices ?? []).map((g) => g.class),
          filed: detail.filingDate,
        },
      });
    }
    const total = body.count ?? allIds.length;
    return {
      total,
      matches,
      note: total > ids.length ? `Checked the newest ${ids.length} of ${total} live marks. Use --limit to check more, or search by hand.` : undefined,
    };
  },
};

// The search response shape is only partly documented publicly, so read it defensively.
function extractIds(body) {
  const arr = body.trademarkIds ?? body.tradeMarkIds ?? body.ids ?? body.results ?? body.trademarks ?? body.data ?? [];
  return (Array.isArray(arr) ? arr : []).map((x) => (typeof x === 'object' ? x.ipRightIdentifier ?? x.number ?? x.id : x)).filter(Boolean);
}

function pick(obj, keys) {
  for (const k of keys) if (obj && typeof obj[k] === 'string') return obj[k];
  return null;
}

function extractWords(detail, depth = 0) {
  if (!detail || typeof detail !== 'object' || depth > 3) return null;
  for (const [k, v] of Object.entries(detail)) {
    if (/^(words?|wording|markText|tradeMarkText|text)$/i.test(k)) {
      if (typeof v === 'string' && v) return v;
      if (Array.isArray(v) && typeof v[0] === 'string') return v.join(' ');
    }
  }
  for (const v of Object.values(detail)) {
    const found = extractWords(Array.isArray(v) ? v[0] : v, depth + 1);
    if (found) return found;
  }
  return null;
}

export const auManual = [
  { label: 'IP Australia trade mark search', url: () => 'https://search.ipaustralia.gov.au/trademarks/search/quick' },
];
