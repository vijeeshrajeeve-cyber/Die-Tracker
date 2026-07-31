'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const cjs = require('./emailSignature.cjs');

// The signature is deliberately implemented twice — once here for the mail the
// server sends on its own, once in src/utils for the drafts the compose modal
// shows the sender before sending (the backend image ships only server/, so it
// cannot import the frontend copy). These tests are the guard rail: if the two
// ever disagree, the company signature has silently forked.
const esmPath = path.join(__dirname, '..', '..', 'src', 'utils', 'emailSignature.js');
const loadEsm = () => import(pathToFileURL(esmPath).href);

const SAMPLE = { name: 'Jaypee Kumar', email: 'jaypee@gulfex.com', phone: '+971 4 8031240' };

test('both copies of the signature render identical HTML', async () => {
  const esm = await loadEsm();
  assert.equal(esm.buildSignature(SAMPLE), cjs.buildSignature(SAMPLE));
  assert.equal(esm.dieDesignSignature(), cjs.dieDesignSignature());
  assert.equal(esm.buildSignature({}), cjs.buildSignature({}));
});

test('both copies of the signature render identical plain text', async () => {
  const esm = await loadEsm();
  assert.equal(esm.signatureText(SAMPLE), cjs.signatureText(SAMPLE));
  assert.equal(esm.dieDesignSignatureText(), cjs.dieDesignSignatureText());
});

test('both copies agree on the department contact', async () => {
  const esm = await loadEsm();
  assert.deepEqual(esm.DIE_DESIGN, cjs.DIE_DESIGN);
});

test('the signature carries the company block and the legal footer', () => {
  const html = cjs.dieDesignSignature();
  assert.ok(html.includes('Gulf Extrusion LLC | A subsidiary of Saif Al Ghurair Group LLC | DUNS No. 851016167'));
  assert.ok(html.includes('PO Box 5598, Jebel Ali Industrial Area 1, Dubai, United Arab Emirates'));
  assert.ok(html.includes('Please consider the environment before printing'));
  assert.ok(html.includes('private and confidential'));
});

test('reminders sign as the department, not as a person', () => {
  assert.ok(cjs.dieDesignSignature().includes('Die Design - GULFEX'));
  assert.ok(cjs.dieDesignSignature().includes('diedesign@gulfex.com'));
});

// A login name is not a signature, and a half-filled account must still produce
// a valid one rather than a blank or a broken line.
test('a named sender signs with their own details, falling back per field', () => {
  const full = cjs.userSignature({ fullName: 'Jaypee Kumar', email: 'jaypee@gulfex.com', phone: '+971 4 8031240' });
  assert.ok(full.includes('Jaypee Kumar'));
  assert.ok(full.includes('jaypee@gulfex.com'));
  assert.ok(full.includes('+971 4 8031240'));

  // No full name on file: the username stands in rather than leaving it blank.
  assert.ok(cjs.userSignature({ username: 'jaypee' }).includes('jaypee'));
  // Nothing on file at all: the department details, never an empty signature.
  const bare = cjs.userSignature({});
  assert.ok(bare.includes('Die Design - GULFEX'));
  assert.ok(bare.includes('diedesign@gulfex.com'));
});

test('a name containing HTML is escaped, not rendered', () => {
  const html = cjs.userSignature({ fullName: '<script>alert(1)</script>' });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
