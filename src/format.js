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
  const bits = [m.status, m.type, m.id].filter(Boolean).join(' | ');
  const out = [`${indent}${TAG[m.match](m.match.toUpperCase().padEnd(7))} ${m.name}${bits ? dim(`  (${bits})`) : ''}`];
  if (m.url) out.push(`${indent}        ${dim(m.url)}`);
  return out.join('\n');
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
      if (!all && hits.length > maxShown) out.push(dim(`      ...and ${hits.length - maxShown} more (use --json or --limit)`));
    }
    const manual = report.manual.filter((m) => m.country === country);
    if (manual.length) {
      out.push(`  ${dim('Check by hand:')}`);
      for (const m of manual) out.push(`    ${m.label}\n      ${dim(m.url)}`);
    }
    out.push('');
  }

  out.push(bold('Summary'));
  for (const country of report.countries) {
    const s = report.summary[country];
    const verdict = s.exact
      ? red(`exact match on ${s.exact} record${s.exact > 1 ? 's' : ''}`)
      : s.close ? yellow(`${s.close} close match${s.close > 1 ? 'es' : ''}, no exact match`) : green('no exact or close match');
    out.push(`  ${country}: ${verdict} ${dim(`(${s.registersChecked} checked, ${s.registersSkipped} skipped${s.registersFailed ? `, ${s.registersFailed} failed` : ''})`)}`);
  }
  out.push('', dim(report.disclaimer));
  return out.join('\n');
}
