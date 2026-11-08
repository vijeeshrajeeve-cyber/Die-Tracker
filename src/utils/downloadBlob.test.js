import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadBlob, REVOKE_DELAY_MS } from './downloadBlob.js';

test('downloadBlob clicks a download link and revokes the URL only later', () => {
  const log = [];
  const a = { click: () => log.push(`click ${a.href} ${a.download}`) };
  const timers = [];
  const env = {
    URL: {
      createObjectURL: (blob) => { log.push(`create ${blob}`); return 'blob:1'; },
      revokeObjectURL: (url) => log.push(`revoke ${url}`),
    },
    document: {
      createElement: (tag) => { assert.equal(tag, 'a'); return a; },
      body: { appendChild: (el) => log.push(`append ${el === a}`), removeChild: (el) => log.push(`remove ${el === a}`) },
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); },
  };
  downloadBlob('PDF', 'x-die-order.pdf', env);
  assert.deepEqual(log, ['create PDF', 'append true', 'click blob:1 x-die-order.pdf', 'remove true'], 'not revoked synchronously');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, REVOKE_DELAY_MS);
  assert.ok(REVOKE_DELAY_MS >= 1000);
  timers[0].fn();
  assert.equal(log.at(-1), 'revoke blob:1');
});
