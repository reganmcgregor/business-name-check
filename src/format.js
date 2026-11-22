import { COUNTRY_NAMES } from './index.js';

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColour ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s) => c(31, s);
const yellow = (s) => c(33, s);
const green = (s) => c(32, s);
const dim = (s) => c(2, s);
const bold = (s) => c(1, s);

const TAG = { exact: (s) => red(bold(s)), close: yellow, related: dim };

function line(m, indent) {
  const bits = [m.details?.state, m.status, m.type, m.id].filter(Boolean).join(' | ');
  const label = m.match.toUpperCase() + (m.active === false ? ' (inactive)' : '');
  const out = [`${indent}${TAG[m.match](label.padEnd(7))} ${m.name}${bits ? dim(`  (${bits})`) : ''}`];
  if (m.url) out.push(`${indent}        ${dim(m.url)}`);
  return out.join('\n');
}

/** The summary never says "clear". It says what was found and what was not checked. */
function verdict(s) {
  const coverage = `${s.registersChecked} of ${s.registersTotal} registers checked${s.registersFailed ? `, ${s.registersFailed} failed` : ''}`;
  if (s.exact) return `${red(`exact match on ${s.exact} active record${s.exact > 1 ? 's' : ''}`)} ${dim(`(${coverage})`)}`;
  if (s.inactiveExact && !s.close) return `${yellow(`exact match on ${s.inactiveExact} inactive record${s.inactiveExact > 1 ? 's' : ''} only`)} ${dim(`(${coverage})`)}`;
  if (s.close) return `${yellow(`${s.close} close match${s.close > 1 ? 'es' : ''}, no exact match`)} ${dim(`(${coverage})`)}`;
  if (!s.registersChecked) return `${dim('nothing checked: no register available without a key')}`;
  const gaps = [];
  if (!s.tradeMarksChecked) gaps.push('trade marks not checked');
  if (!s.complete) gaps.push('some registers skipped or failed');
  return `nothing found ${dim(`(${coverage}${gaps.length ? `; ${gaps.join('; ')}` : ''})`)}`;
}

export function formatText(report, { all = false, maxShown = 10 } = {}) {
  const out = [];
  out.push(bold(`Checking "${report.query}"`) + dim(`  (matched as "${report.normalised}")`), '');

  for (const country of report.countries) {
    out.push(bold(COUNTRY_NAMES[country].toUpperCase()));
    for (const r of report.results.filter((x) => x.country === country)) {
      const kind = r.kind === 'trademark' ? 'trade marks' : 'business';
      if (r.status === 'skipped') {
        out.push(`  ${dim('-')} ${r.label} ${dim(`[${kind}]`)}: skipped. ${r.reason}${r.signup ? `\n      Free key: ${r.signup}` : ''}`);
        continue;
      }
      if (r.status === 'error') {
        out.push(`  ${red('!')} ${r.label} ${dim(`[${kind}]`)}: failed. ${r.reason}`);
        continue;
      }
      const hits = r.matches.filter((m) => m.match !== 'related');
      const related = r.matches.length - hits.length;
      const mark = hits.length ? yellow('*') : green('+');
      out.push(`  ${mark} ${r.label} ${dim(`[${kind}]`)}: ${hits.length ? `${hits.length} exact or close` : 'no exact or close match'}${related ? dim(`, ${related} loosely related`) : ''}`);
      const shown = (all ? r.matches : hits).slice(0, all ? r.matches.length : maxShown);
      for (const m of shown) out.push(line(m, '      '));
      if (r.note) out.push(dim(`      ${r.note}`));
      if (!all && hits.length > maxShown) out.push(dim(`      ...and ${hits.length - maxShown} more (use --json or --limit)`));
    }
    const manual = report.manual.filter((m) => m.country === country);
    if (manual.length) {
      out.push(`  ${dim('Check by hand:')}`);
      for (const m of manual) out.push(`    ${m.label}\n      ${dim(m.url)}`);
    }
    out.push('');
  }

  if (report.domains?.length) {
    out.push(bold('DOMAIN NAMES') + dim('  (a weaker signal than a register match)'));
    for (const d of report.domains) {
      const text = d.status === 'registered' ? yellow('registered')
        : d.status === 'not_found' ? 'not found in the registry' : dim('could not check');
      out.push(`  ${d.domain.padEnd(28)} ${text}`);
    }
    out.push(dim(`  ${report.domainNote}`), '');
  }

  out.push(bold('Summary'));
  for (const country of report.countries) {
    out.push(`  ${country}: ${verdict(report.summary[country])}`);
  }
  out.push('', dim(report.disclaimer));
  return out.join('\n');
}
