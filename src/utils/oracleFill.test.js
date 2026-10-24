import test from 'node:test';
import assert from 'node:assert/strict';
import { oracleFill, bookmarkletHref } from './oracleFill.js';
import { ORACLE_BATCH_MARK } from './oracleEntry.js';

test('the bookmark is a javascript: link that runs the filler on its own', () => {
  const href = bookmarkletHref();
  assert.ok(href.startsWith('javascript:'));
  const body = decodeURIComponent(href.slice('javascript:'.length));
  assert.doesNotThrow(() => new Function(body), 'the link body parses as a script');
  assert.ok(body.includes(ORACLE_BATCH_MARK), 'it recognises the batch the tracker copies');
});

test('the filler leans on nothing outside itself, so it survives being turned into a link', () => {
  // A free reference would be undefined once the function runs inside Oracle.
  const run = new Function(`return (${oracleFill.toString()})`)();
  assert.equal(typeof run, 'function');
});
