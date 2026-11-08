import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewReasonLabel, confidenceTone, isToolingReviewer, statusTone, queueRowsFromApi, filtersToParams, inferKind, parsePocketsJson, matchesConfidence,
} from './toolingsView.js';

test('reviewReasonLabel names the tooling reasons and passes profile reasons through', () => {
  assert.equal(reviewReasonLabel('unverified'), 'Unverified number');
  assert.equal(reviewReasonLabel('no-opening'), 'No drawing opening');
  assert.equal(reviewReasonLabel('no-pockets'), 'Opening not known');
  assert.equal(reviewReasonLabel('uncertain'), 'Opening uncertain');
  assert.equal(reviewReasonLabel('no-size-class'), 'Size class unknown');
  assert.equal(reviewReasonLabel('ccd mismatch 12%'), 'ccd mismatch 12%');
  assert.equal(reviewReasonLabel(null), 'Needs review');
  assert.equal(reviewReasonLabel(''), 'Needs review');
});

test('confidenceTone maps the confidence vocabulary to pill tones', () => {
  assert.equal(confidenceTone('confirmed'), 'ok');
  assert.equal(confidenceTone('likely'), 'muted');
  assert.equal(confidenceTone('uncertain'), 'warn');
  assert.equal(confidenceTone('none'), 'no');
  assert.equal(confidenceTone(null), 'no');
  assert.equal(confidenceTone(undefined), 'no');
});

test('queueRowsFromApi merges openings and pictures into one list, newest first when dated', () => {
  const openings = [
    { number: 'I-1', kind: 'insert', plant: 'GEX 1', size_class: null, status: 'unverified', opening_confidence: 'none', drawing_count: 0, reason: 'unverified' },
    { number: 'B-2', kind: 'bolster', plant: 'GEX 2', size_class: '700X196', status: 'active', opening_confidence: 'uncertain', drawing_count: 2, reason: 'uncertain' },
  ];
  const profiles = [
    { id: 5, die_no: 'D-5', plant: 'GEX 1', profile_number: 'P5', source: 'order-pdf', source_ref: '12', review_reason: 'ccd mismatch', style: 'outline', hole_count: 1, has_image: true, updated_at: '2026-11-01T10:00:00Z' },
    { id: 9, die_no: 'D-9', plant: 'GEX 2', profile_number: null, source: 'image-check-xlsx', source_ref: 'GEX2!E9', review_reason: null, style: 'silhouette', hole_count: 0, has_image: false, updated_at: '2026-11-05T10:00:00Z' },
  ];
  const rows = queueRowsFromApi(openings, profiles);
  assert.deepEqual(rows.map((r) => r.key), ['profile:9', 'profile:5', 'opening:I-1', 'opening:B-2']);
  const pic = rows[1];
  assert.equal(pic.kind, 'profile');
  assert.equal(pic.title, 'D-5');
  assert.equal(pic.plant, 'GEX 1');
  assert.equal(pic.reason, 'ccd mismatch');
  assert.match(pic.subtitle, /Profile P5/);
  assert.match(pic.subtitle, /order-pdf/);
  assert.match(pic.subtitle, /1 hole/);
  assert.equal(pic.raw, profiles[0]);
  assert.equal(rows[0].reason, 'Needs review');
  const op = rows[3];
  assert.equal(op.kind, 'opening');
  assert.equal(op.title, 'B-2');
  assert.equal(op.reason, 'Opening uncertain');
  assert.match(op.subtitle, /Bolster/);
  assert.match(op.subtitle, /700X196/);
  assert.match(op.subtitle, /2 drawings/);
  assert.match(rows[2].subtitle, /size unknown/);
  assert.match(rows[2].subtitle, /no drawing/);
  assert.deepEqual(queueRowsFromApi(null, undefined), []);
});

test('filtersToParams drops empty values and keeps confidence out of the server params', () => {
  assert.deepEqual(
    filtersToParams({ plant: 'GEX 1', press: '', kind: 'insert', sizeClass: ' 175X80 ', status: 'active', confidence: 'confirmed', q: '  I-12 ' }),
    { plant: 'GEX 1', kind: 'insert', sizeClass: '175X80', status: 'active', q: 'I-12' },
  );
  assert.deepEqual(filtersToParams({ plant: null, press: undefined, status: 'all' }), { status: 'all' });
  assert.deepEqual(filtersToParams({}), {});
  assert.deepEqual(filtersToParams({ limit: 50, offset: 0 }), { limit: '50', offset: '0' });
});

test('matchesConfidence filters a page of rows by opening confidence on the client', () => {
  assert.equal(matchesConfidence({ opening_confidence: 'likely' }, ''), true);
  assert.equal(matchesConfidence({ opening_confidence: 'likely' }, 'likely'), true);
  assert.equal(matchesConfidence({ opening_confidence: 'likely' }, 'confirmed'), false);
  assert.equal(matchesConfidence({ opening_confidence: null }, 'none'), true);
});

test('inferKind reads insert numbers and leaves the rest as bolster', () => {
  assert.equal(inferKind('I-12999'), 'insert');
  assert.equal(inferKind('25IC2-030724'), 'insert');
  assert.equal(inferKind(' i-5 '), 'insert');
  assert.equal(inferKind('BOL-4-6'), 'bolster');
  assert.equal(inferKind(''), '');
});

test('parsePocketsJson accepts polygons of 3+ finite pairs and explains what is wrong otherwise', () => {
  const ok = parsePocketsJson('[[[0,0],[10,0],[10,5]],[[20,0],[30,0],[30,5],[20,5]]]');
  assert.equal(ok.error, null);
  assert.equal(ok.pockets.length, 2);
  assert.match(parsePocketsJson('not json').error, /not valid JSON/);
  assert.match(parsePocketsJson('[]').error, /at least one pocket/);
  assert.match(parsePocketsJson('[[[0,0],[1,1]]]').error, /Pocket 1/);
  assert.match(parsePocketsJson('[[[0,0],[1,1],[2,"x"]]]').error, /Pocket 1/);
  assert.match(parsePocketsJson('[[[0,0],[1,1],[2,2]],[[0,0]]]').error, /Pocket 2/);
});

test('isToolingReviewer is admins and users with the review switch; statusTone colours the status pill', () => {
  assert.equal(isToolingReviewer({ role: 'admin' }), true);
  assert.equal(isToolingReviewer({ role: 'user', canReviewToolings: true }), true);
  assert.equal(isToolingReviewer({ role: 'user', canReviewToolings: false }), false);
  assert.equal(isToolingReviewer({ role: 'user' }), false);
  assert.equal(isToolingReviewer(null), false);
  assert.equal(statusTone('active'), 'ok');
  assert.equal(statusTone('unverified'), 'warn');
  assert.equal(statusTone('retired'), 'muted');
});
