// Interactive key setup: hidden input, writes ./.env, then tests each key you entered.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { checkName } from './index.js';

const FIELDS = [
  { key: 'ABR_GUID', label: 'Australia ABN Lookup GUID', country: 'AU', secret: true },
  { key: 'IPA_CLIENT_ID', label: 'IP Australia client ID', country: 'AU', secret: false },
  { key: 'IPA_CLIENT_SECRET', label: 'IP Australia client secret', country: 'AU', secret: true },
  { key: 'COMPANIES_HOUSE_API_KEY', label: 'UK Companies House API key', country: 'UK', secret: true },
  { key: 'NZBN_SUBSCRIPTION_KEY', label: 'NZ NZBN subscription key', country: 'NZ', secret: true },
  { key: 'SEC_USER_AGENT', label: 'US SEC User-Agent (your name and email)', country: 'US', secret: false },
  { key: 'OPENCORPORATES_API_TOKEN', label: 'US OpenCorporates API token', country: 'US', secret: true },
];

function ask(prompt, hidden) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    let buf = '';
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(buf.trim());
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f') { buf = buf.slice(0, -1); continue; }
        buf += ch;
        if (!hidden) process.stdout.write(ch);
      }
    };
    stdin.on('data', onData);
  });
}

function readEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export async function runSetup(path = '.env') {
  console.log(`Press Enter to skip any key you do not have. Secret input is hidden. Saved to ${path}.\n`);
  const current = readEnvFile(path);
  const entered = {};
  for (const f of FIELDS) {
    const have = current[f.key] ? ' (already set, Enter keeps it)' : '';
    const value = await ask(`${f.label}${have}: `, f.secret);
    if (value) entered[f.key] = value;
  }
  const merged = { ...current, ...entered };
  writeFileSync(path, `${Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
  console.log(`\nSaved ${Object.keys(merged).length} value(s) to ${path}. Testing each register you have a key for...\n`);

  const countries = [...new Set(FIELDS.filter((f) => merged[f.key]).map((f) => f.country))];
  if (!countries.length) return;
  const report = await checkName('Woolworths', { countries, env: { ...process.env, ...merged }, limit: 3 });
  for (const r of report.results.filter((x) => x.status !== 'skipped')) {
    console.log(`${r.status === 'ok' ? 'OK    ' : 'FAILED'} ${r.label}${r.status === 'ok' ? `  (${r.matches.length} results)` : `: ${r.reason}`}`);
  }
}
