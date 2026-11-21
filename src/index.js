import { classify, nameKey, rankMatches } from './match.js';
import { abr, asicBusinessNames, asicCompanies, auManual, ipAustralia } from './registers/au.js';
import { companiesHouse, ukManual } from './registers/uk.js';
import { nzbn, nzManual } from './registers/nz.js';
import { secEdgar, usManual, usStateOpenData } from './registers/us.js';
import { checkDomains, DOMAIN_NOTE, resolveTlds } from './domains.js';

export const REGISTERS = [
  asicBusinessNames, asicCompanies, abr, ipAustralia,
  companiesHouse,
  nzbn,
  secEdgar, usStateOpenData,
];

export const MANUAL = { AU: auManual, UK: ukManual, NZ: nzManual, US: usManual };
export const COUNTRIES = ['AU', 'NZ', 'UK', 'US'];
export const COUNTRY_NAMES = { AU: 'Australia', NZ: 'New Zealand', UK: 'United Kingdom', US: 'United States' };

export const DISCLAIMER =
  'A register match is a warning, not a legal opinion. No match does not mean the name is safe: ' +
  'this tool does not search every register, and it is not a trade mark clearance. ' +
  'Get advice from a trade mark attorney before you commit to a name.';

export function parseCountries(input) {
  if (!input || input.toLowerCase() === 'all') return COUNTRIES;
  const out = [];
  for (const raw of input.split(',')) {
    const c = raw.trim().toUpperCase().replace('GB', 'UK');
    if (!COUNTRIES.includes(c)) throw new Error(`Unknown country "${raw}". Use au, nz, uk, us or all.`);
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

async function runRegister(register, name, env, opts) {
  const base = {
    id: register.id,
    country: register.country,
    kind: register.kind,
    label: register.label,
    coverage: register.coverage,
  };
  const missing = register.env.filter((k) => !env[k]);
  if (missing.length) {
    return {
      ...base,
      status: 'skipped',
      reason: `Set ${missing.join(' and ')} to enable this register.`,
      signup: register.signup,
      matches: [],
    };
  }
  try {
    const { matches, total, note } = await register.search(name, env, opts);
    const classified = rankMatches(matches.map((m) => ({ active: null, ...m, match: classify(name, m.name) })));
    return { ...base, status: 'ok', total, note, matches: classified };
  } catch (err) {
    const auth = err.status === 401 || err.status === 403;
    return {
      ...base,
      status: 'error',
      reason: auth
        ? `Rejected the credentials (HTTP ${err.status}). Check ${register.env.join(', ') || 'the request'}.`
        : err.message,
      matches: [],
    };
  }
}

/** Per-country counts. "active" means active or unknown; inactive records are counted apart. */
function summarise(countries, results) {
  return Object.fromEntries(countries.map((c) => {
    const rs = results.filter((r) => r.country === c);
    const checked = rs.filter((r) => r.status === 'ok');
    const all = checked.flatMap((r) => r.matches);
    const live = (m) => m.active !== false;
    return [c, {
      registersTotal: rs.length,
      registersChecked: checked.length,
      registersSkipped: rs.filter((r) => r.status === 'skipped').length,
      registersFailed: rs.filter((r) => r.status === 'error').length,
      tradeMarksChecked: checked.some((r) => r.kind === 'trademark'),
      complete: rs.length > 0 && checked.length === rs.length,
      exact: all.filter((m) => m.match === 'exact' && live(m)).length,
      close: all.filter((m) => m.match === 'close' && live(m)).length,
      inactiveExact: all.filter((m) => m.match === 'exact' && !live(m)).length,
    }];
  }));
}

/**
 * Check a name against the registers for the given countries.
 * @param {string} name
 * @param {{countries?: string[], env?: object, limit?: number, domains?: boolean, tlds?: string[]}} options
 */
export async function checkName(name, { countries = COUNTRIES, env = process.env, limit = 25, domains = true, tlds } = {}) {
  if (!String(name ?? '').trim()) throw new Error('A name to check is required.');
  const registers = REGISTERS.filter((r) => countries.includes(r.country));
  const [results, domainResults] = await Promise.all([
    Promise.all(registers.map((r) => runRegister(r, name, env, { limit }))),
    domains ? checkDomains(name, resolveTlds(countries, tlds)) : Promise.resolve([]),
  ]);

  const manual = countries.flatMap((c) =>
    (MANUAL[c] ?? []).map((m) => ({ country: c, label: m.label, url: m.url(name) })));

  return {
    query: name,
    normalised: nameKey(name),
    checkedAt: new Date().toISOString(),
    countries,
    results,
    manual,
    summary: summarise(countries, results),
    domains: domainResults,
    domainNote: domains ? DOMAIN_NOTE : undefined,
    disclaimer: DISCLAIMER,
  };
}

/** Exit code for --exit-code: 0 nothing found, 1 an active exact match, 3 a register failed and nothing else was found. */
export function exitCodeFor(report) {
  const s = Object.values(report.summary);
  if (s.some((c) => c.exact > 0)) return 1;
  if (s.some((c) => c.registersFailed > 0)) return 3;
  return 0;
}
