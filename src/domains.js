// Domain name checks: is a matching domain registered? Keyless, via RDAP, with WHOIS for .nz.
// This is a weaker signal than a register match. "Not found" is not proof a domain can be bought:
// it may be reserved, premium, or about to be released.

import net from 'node:net';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from './http.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';

export const DEFAULT_TLDS = { ALL: ['com'], AU: ['com.au'], NZ: ['co.nz'], UK: ['co.uk'], US: [] };

/** Domain labels for a name: with "&" read as "and", and with it dropped. At most two. */
export function domainLabels(name) {
  const base = String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = (s) => s.replace(/[^a-z0-9]+/g, '').slice(0, 63);
  const withAnd = words(base.replace(/&/g, ' and '));
  const withoutAnd = words(base.replace(/&/g, ' ').replace(/\band\b/g, ' '));
  return [...new Set([withAnd, withoutAnd])].filter((l) => l.length > 0);
}

export function resolveTlds(countries, custom) {
  const raw = custom ?? [...DEFAULT_TLDS.ALL, ...countries.flatMap((c) => DEFAULT_TLDS[c] ?? [])];
  return [...new Set(raw.map((t) => t.trim().toLowerCase().replace(/^\./, '')).filter(Boolean))];
}

async function loadBootstrap() {
  const cache = join(process.env.BNC_CACHE_DIR ?? tmpdir(), 'business-name-check-iana-rdap-dns.json');
  try {
    const info = await stat(cache);
    if (Date.now() - info.mtimeMs < DAY_MS) return JSON.parse(await readFile(cache, 'utf8'));
  } catch { /* no cache yet */ }
  const res = await request(BOOTSTRAP_URL);
  try { await writeFile(cache, res.text); } catch { /* cache is optional */ }
  return res.json();
}

function rdapBase(bootstrap, tld) {
  const last = tld.split('.').pop();
  for (const [tlds, urls] of bootstrap.services) {
    if (tlds.includes(last)) return urls.find((u) => u.startsWith('https://')) ?? urls[0];
  }
  return null;
}

function whois(host, query, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: 43 });
    let data = '';
    socket.setTimeout(timeoutMs, () => { socket.destroy(); reject(new Error('WHOIS timeout')); });
    socket.on('connect', () => socket.write(`${query}\r\n`));
    socket.on('data', (d) => { data += d; });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

async function checkOne(domain, tld, bootstrap) {
  if (tld === 'nz' || tld.endsWith('.nz')) {
    try {
      const text = await whois('whois.irs.net.nz', domain);
      if (/^not found/im.test(text)) return { status: 'not_found', source: 'whois' };
      if (/^domain name:/im.test(text)) return { status: 'registered', source: 'whois' };
      return { status: 'unknown', source: 'whois' };
    } catch {
      return { status: 'unknown', source: 'whois' };
    }
  }
  const base = rdapBase(bootstrap, tld);
  if (!base) return { status: 'unknown', source: 'none' };
  try {
    await request(`${base.replace(/\/?$/, '/')}domain/${domain}`, { headers: { accept: 'application/rdap+json, application/json' }, retries: 1 });
    return { status: 'registered', source: 'rdap' };
  } catch (err) {
    return { status: err.status === 404 ? 'not_found' : 'unknown', source: 'rdap' };
  }
}

export const DOMAIN_NOTE =
  'A domain that is not found in the registry may still be reserved, premium or about to be released, and ' +
  '.com.au needs an Australian connection such as an ABN. A taken domain does not mean a name is taken as a business or trade mark.';

/**
 * @param {string} name
 * @param {string[]} tlds  e.g. ['com', 'com.au']
 */
export async function checkDomains(name, tlds) {
  const labels = domainLabels(name);
  if (!labels.length || !tlds.length) return [];
  let bootstrap = { services: [] };
  try { bootstrap = await loadBootstrap(); } catch { /* every lookup becomes unknown */ }
  const jobs = labels.flatMap((label) => tlds.map(async (tld) => {
    const domain = `${label}.${tld}`;
    return { domain, tld, ...(await checkOne(domain, tld, bootstrap)) };
  }));
  return Promise.all(jobs);
}
