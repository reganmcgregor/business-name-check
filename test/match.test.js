import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, nameKey, normalise } from '../src/match.js';

test('normalise folds case, accents, ampersands and punctuation', () => {
  assert.equal(normalise('Heat & Chill'), 'heat and chill');
  assert.equal(normalise('Café  Déjà-Vu!'), 'cafe deja vu');
});

test('nameKey drops legal suffixes and a leading "the"', () => {
  assert.equal(nameKey('The Brightwater Pty Ltd'), 'brightwater');
  assert.equal(nameKey('Acme Co Limited'), 'acme');
  assert.equal(nameKey('Co'), 'co'); // never strips down to nothing
});

test('classify: exact', () => {
  assert.equal(classify('Heat & Chill', 'HEAT AND CHILL PTY LTD'), 'exact');
  assert.equal(classify('Heat & Chill', 'Heat&Chill'), 'exact');
  assert.equal(classify('Woolworths', 'WOOLWORTHS LTD'), 'exact');
  assert.equal(classify('Heat Chill', 'HeatChill'), 'exact');
});

test('classify: close', () => {
  assert.equal(classify('Woolworths', 'Woolworths Group Payments'), 'close');
  assert.equal(classify('Brightwater', 'Brightwatter'), 'close');
  assert.equal(classify('Heat Chill', 'Chill and Heat Co'), 'close');
});

test('classify: related', () => {
  assert.equal(classify('Woolworths', 'Coles Supermarkets'), 'related');
  assert.equal(classify('', 'Anything'), 'related');
});
