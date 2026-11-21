import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { domainLabels, resolveTlds, checkDomains } from '../src/domains.js';

process.env.BNC_MIN_DELAY_MS = '0';
process.env.BNC_CACHE_DIR = mkdtempSync(join(tmpdir(), 'bnc-dom-test-'));
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('domainLabels reads & as "and" and also drops it', () => {
  assert.deepEqual(domainLabels('Heat & Chill'), ['heatandchill', 'heatchill']);
  assert.deepEqual(domainLabels('Brightwater'), ['brightwater']);
  assert.deepEqual(domainLabels('Café Déjà-Vu'), ['cafedejavu']);
  assert.deepEqual(domainLabels('!!!'), []);
  assert.ok(domainLabels('a'.repeat(100))[0].length <= 63);
});

test('resolveTlds: .com plus the selected countries, or exactly what was asked for', () => {
  assert.deepEqual(resolveTlds(['AU']), ['com', 'com.au']);
  assert.deepEqual(resolveTlds(['US']), ['com']);
  assert.deepEqual(resolveTlds(['AU', 'NZ', 'UK']), ['com', 'com.au', 'co.nz', 'co.uk']);
  assert.deepEqual(resolveTlds(['AU'], ['.shop', 'Store']), ['shop', 'store']);
});

test('checkDomains maps RDAP 200/404/other to registered/not_found/unknown', async () => {
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.includes('dns.json')) return new Response(JSON.stringify({ services: [[['com'], ['https://rdap.example/com/']]] }));
    if (url.endsWith('/taken.com')) return new Response('{}', { status: 200 });
    if (url.endsWith('/free.com')) return new Response('{}', { status: 404 });
    return new Response('boom', { status: 400 });
  };
  const taken = await checkDomains('taken', ['com']);
  assert.equal(taken[0].status, 'registered');
  const free = await checkDomains('free', ['com']);
  assert.equal(free[0].status, 'not_found');
  const odd = await checkDomains('odd', ['com']);
  assert.equal(odd[0].status, 'unknown');
  const noRdap = await checkDomains('x', ['zzz']);
  assert.equal(noRdap[0].status, 'unknown');
});
