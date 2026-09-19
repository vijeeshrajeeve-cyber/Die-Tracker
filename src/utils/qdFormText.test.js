import test from 'node:test';
import assert from 'node:assert/strict';
import {
  qdFormTextFromItems, parseQdFormText, parseFormDate, joinWrappedLines,
  supplierCodeFromQdNo, dieNoFromFilename,
} from './qdFormText.js';

// The text pdfjs pulls out of the real 2026PH-04 form, joined item by item
// with a newline wherever pdfjs set hasEOL. Word's table cells come out in
// reading order; the labelled fields are what the parser relies on.
const SAMPLE = 'DATE 4-Jun-26\nQD # 2026PH-04\nProfile\nNo Die no\nDie\nReceived\ndate\nSupplier\nName Press Die Type Die size\nNo of\nCavity Tooling\nNo of\ntrials\nNo of\ncorrection\ndone\n30601 201 9-Apr-26 Phoenix P2 Hollow 475x280 1 BOL\n30587 5 4\nDate Die Soaking\nHours\nDie\nTemperature\nBillet\ntemp\nBreak\nthrough\nPressure\nRunning\nPressure\nBillet\nlength Alloy Ram\nSpeed\nAny Delay\nobserved\n1st Billet\nDetails 502 204 167 499 6063 4.2\nLast Billet\nDetails 498 204 162 601 6063 6\nNo\nQuality Discrepancy : The quality issue was raised because a heavy blend was observed on the\nprofile after trial production.\nDuring the initial trial, the required profile shape was not achieved. Therefore, the die was sent to PHME for\nrework to remove concavity.\nAfter the rework trial, the required shape was achieved, but a heavy blend was still observed. The attached\nimage clearly shows this issue.\nThe input material weight used was 513 kg.\nManufacturing Defect Die Performance Yes\nQuality Discrepancy\nPart-A (To be filled by Gulfex Team)\nProduction Parameters\n1-Jun-26 4 hours 460 No any delay\nobserved1st Trial NoseLast trial NoseBlend Marks on Profile\nYES NO ETA\nReceived By (Supplier)\nQuality Discrepancy Closed on\nPrepared By Veera\nAuthorized By Imran Mulla\nPart-B (To be filled by Supplier)\nQuality Discrepancy Acceptance\nAction Taken\nSupplier Comments/Corrective Action\nNote- Quality Discrepancy should be closed within 10 Working Days\nName Signature\nProfile Image Approved design\nRecommended Action :\nBased on the above observations, we kindly request you to provide a replacement FOC dieplate\non an urgent basis.As for 1st trialAs for last trial';

test('reads every labelled field from the 2026PH-04 form', () => {
  assert.deepEqual(parseQdFormText(SAMPLE), {
    qdNo: '2026PH-04',
    raisedDate: '2026-06-04',
    supplierCode: 'PH',
    profileNo: '30601',
    dieSuffix: '201',
    issue: 'The quality issue was raised because a heavy blend was observed on the profile after trial production.\n'
      + 'During the initial trial, the required profile shape was not achieved. Therefore, the die was sent to PHME for rework to remove concavity.\n'
      + 'After the rework trial, the required shape was achieved, but a heavy blend was still observed. The attached image clearly shows this issue.\n'
      + 'The input material weight used was 513 kg.',
    recommendedAction: 'Based on the above observations, we kindly request you to provide a replacement FOC dieplate on an urgent basis.',
    preparedBy: 'Veera',
    authorizedBy: 'Imran Mulla',
  });
});

test('joins pdfjs items, breaking lines on hasEOL and between pages', () => {
  const pages = [
    [{ str: 'DATE' }, { str: ' ' }, { str: '4-Jun-26' }, { str: '', hasEOL: true }, { str: 'QD #' }],
    [{ str: 'Prepared By' }, { str: ' ' }, { str: 'Veera', hasEOL: true }],
  ];
  assert.equal(qdFormTextFromItems(pages), 'DATE 4-Jun-26\nQD #\nPrepared By Veera\n');
  assert.equal(qdFormTextFromItems(undefined), '');
});

test('form dates become ISO dates; anything else is blank', () => {
  assert.equal(parseFormDate('4-Jun-26'), '2026-06-04');
  assert.equal(parseFormDate('04-June-2026'), '2026-06-04');
  assert.equal(parseFormDate('9-Apr-26'), '2026-04-09');
  assert.equal(parseFormDate('31-Feb-26'), '');
  assert.equal(parseFormDate('Jun 4'), '');
  assert.equal(parseFormDate(''), '');
});

test('a die row that is not profile + suffix is left blank, not guessed', () => {
  const shifted = 'done\n9-Apr-26 Phoenix P2 Hollow\n';
  const p = parseQdFormText(shifted);
  assert.equal(p.profileNo, '');
  assert.equal(p.dieSuffix, '');
});

test('absent labels and empty names come back blank', () => {
  const blank = parseQdFormText('');
  for (const v of Object.values(blank)) assert.equal(v, '');
  // An unsigned Prepared By must not swallow the next line.
  const p = parseQdFormText('Prepared By\nAuthorized By Imran Mulla\n');
  assert.equal(p.preparedBy, '');
  assert.equal(p.authorizedBy, 'Imran Mulla');
  // The form title and "Quality Discrepancy Closed on" are not the issue.
  assert.equal(parseQdFormText('Quality Discrepancy\nQuality Discrepancy Closed on\nManufacturing Defect').issue, '');
});

test('the supplier code comes only from a YYYYCC-NN number', () => {
  assert.equal(supplierCodeFromQdNo('2026PH-04'), 'PH');
  assert.equal(supplierCodeFromQdNo('2026ph-4'), 'PH');
  assert.equal(supplierCodeFromQdNo('2026-01'), '');
  assert.equal(supplierCodeFromQdNo(''), '');
});

test('filename die numbers follow the PDF import convention', () => {
  // The sample's filename and its form disagree (320601 vs 30601): the modal
  // shows both, which is why this helper exists at all.
  assert.equal(dieNoFromFilename('320601-201 Quality discrepancy 2026PH-04.pdf'), '320601-201');
  assert.equal(dieNoFromFilename('051150_807.pdf'), '051150-807');
  assert.equal(dieNoFromFilename('QD-2026PD-02.pdf'), '');
});

test('wrapped lines rejoin; a line ending a sentence starts a new paragraph', () => {
  assert.equal(joinWrappedLines('a heavy blend on the\nprofile.\nNext one'), 'a heavy blend on the profile.\nNext one');
  assert.equal(joinWrappedLines('  \n'), '');
});
