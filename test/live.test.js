// Live checks against the real registers. Run with: npm run test:live
// Needs a .env (or exported keys). A register without its key is skipped, not failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { checkName } from '../src/index.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const live = process.env.LIVE === '1';

// [country, taken name, register ids that should return an exact match when keyed]
const TAKEN = [
  ['AU', 'Woolworths', ['au-asic-business-names', 'au-asic-companies', 'au-abr', 'au-ip-australia']],
  ['UK', 'Tesco', ['uk-companies-house']],
  ['NZ', 'Fonterra', ['nz-nzbn']],
  ['US', 'Walmart', ['us-sec-edgar', 'us-opencorporates']],
];
const FREE = 'Zqxvlorn Quillmark Brightfen';

for (const [country, taken, ids] of TAKEN) {
  test(`${country}: "${taken}" is taken`, { skip: !live }, async () => {
    const r = await checkName(taken, { countries: [country] });
    for (const id of ids) {
      const res = r.results.find((x) => x.id === id);
      if (res.status === 'skipped') { console.log(`  skipped ${id}: ${res.reason}`); continue; }
      assert.equal(res.status, 'ok', `${id}: ${res.reason}`);
      assert.ok(res.matches.some((m) => m.match === 'exact'), `${id} should find an exact match for ${taken}`);
    }
  });

  test(`${country}: gibberish name is free`, { skip: !live }, async () => {
    const r = await checkName(FREE, { countries: [country] });
    for (const res of r.results.filter((x) => x.status !== 'skipped')) {
      assert.equal(res.status, 'ok', `${res.id}: ${res.reason}`);
      assert.equal(res.matches.filter((m) => m.match === 'exact').length, 0, res.id);
    }
  });
}

test('"Heat & Chill" runs on every register that has a key', { skip: !live }, async () => {
  const r = await checkName('Heat & Chill');
  for (const res of r.results.filter((x) => x.status !== 'skipped')) {
    assert.equal(res.status, 'ok', `${res.id}: ${res.reason}`);
  }
});
