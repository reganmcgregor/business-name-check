#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { checkName, exitCodeFor, parseCountries, REGISTERS } from '../src/index.js';
import { formatText } from '../src/format.js';

const HELP = `business-name-check: is this business or brand name already taken?

Usage
  business-name-check <name> [options]

Options
  -c, --country <list>   au, nz, uk, us (comma separated) or all. Default: all
      --json             Print JSON instead of text (for scripts, n8n and AI agents)
      --all              Also list loosely related results
  -l, --limit <n>        Results to request per register. Default: 25
      --env-file <path>  Load API keys from this file. Default: ./.env if present
      --no-domains       Skip the domain name checks
      --domains <list>   Domain endings to check instead of the defaults, e.g. com,com.au,shop
      --exit-code        Exit 1 on an active exact match, 3 if a register failed (default is always 0)
      --setup            Prompt for API keys (hidden input) and save them to ./.env
      --list             List the registers, the keys they need and where to get them
  -h, --help             Show this help

Examples
  business-name-check "Heat & Chill" --country au
  business-name-check "Brightwater" --json

Keys are read from environment variables (see .env.example). Registers without
a key are skipped, so it still runs with no keys at all.`;

function fail(msg) {
  console.error(`Error: ${msg}\n\nRun with --help for usage.`);
  process.exit(2);
}

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      country: { type: 'string', short: 'c' },
      json: { type: 'boolean' },
      all: { type: 'boolean' },
      limit: { type: 'string', short: 'l' },
      'env-file': { type: 'string' },
      list: { type: 'boolean' },
      setup: { type: 'boolean' },
      'no-domains': { type: 'boolean' },
      domains: { type: 'string' },
      'exit-code': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (err) {
  fail(err.message);
}
const { values, positionals } = args;

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

if (values.setup) {
  const { runSetup } = await import('../src/setup.js');
  await runSetup(values['env-file'] ?? '.env');
  process.exit(0);
}

const envFile = values['env-file'] ?? (existsSync('.env') ? '.env' : null);
if (envFile) {
  if (!values['env-file'] && !values.json) console.error(`Loading keys from ./${envFile} (use --env-file to choose another file)`);
  if (!existsSync(envFile)) fail(`env file not found: ${envFile}`);
  process.loadEnvFile(envFile); // does not override variables already set in the shell
}

if (values.list) {
  for (const r of REGISTERS) {
    const keys = r.env.length ? r.env.join(' + ') : 'no key needed';
    console.log(`${r.country}  ${r.label}\n    ${r.coverage}\n    Needs: ${keys}${r.signup ? `\n    Get it: ${r.signup}` : ''}\n`);
  }
  process.exit(0);
}

const name = positionals.join(' ').trim();
if (!name) fail('give the name to check, for example: business-name-check "Heat & Chill"');

let countries;
try {
  countries = parseCountries(values.country);
} catch (err) {
  fail(err.message);
}
const limit = values.limit ? Number(values.limit) : 25;
if (!Number.isInteger(limit) || limit < 1) fail('--limit must be a positive whole number');

const tlds = values.domains ? values.domains.split(',') : undefined;
const report = await checkName(name, { countries, limit, domains: !values['no-domains'], tlds });
console.log(values.json ? JSON.stringify(report, null, 2) : formatText(report, { all: values.all }));
if (values['exit-code']) process.exitCode = exitCodeFor(report);
