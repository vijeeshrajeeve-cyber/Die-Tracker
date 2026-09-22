'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { strictDate, localDate, dueDate, localCutoffInstant, classify, pauseCredit, validateCalendar } = require('./workQueueCalendar.cjs');

const calendar = { timezone: 'Asia/Dubai', weekdays: [1, 2, 3, 4, 5, 6], holidays: [], cutoff: '17:00' };
const badRequest = error => error.status === 400 && error.statusCode === 400;

test('strict dates reject rollover, timestamps and non-ISO input while accepting leap years', () => {
  assert.equal(strictDate('2024-02-29'), '2024-02-29');
  assert.equal(strictDate('2000-02-29'), '2000-02-29');
  for (const value of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-00-12', '2026-13-12', '2026-09-00', '2026-9-21', '21/09/2026', '2026-09-21T00:00:00Z', '', null, undefined, 1]) {
    assert.equal(strictDate(value), null, String(value));
  }
});

test('working deadline excludes entry date, Sundays and plant holidays', () => {
  assert.equal(dueDate('2026-09-19', 1, 'working_days', calendar), '2026-09-21');
  assert.equal(dueDate('2026-09-20', 1, 'working_days', calendar), '2026-09-21');
  assert.equal(dueDate('2026-09-21', 7, 'working_days', calendar), '2026-09-29');
  assert.equal(dueDate('2026-09-19', 1, 'working_days', { ...calendar, holidays: ['2026-09-21'] }), '2026-09-22');
});

test('calendar deadlines and alternate working weeks are explicit modes', () => {
  assert.equal(dueDate('2026-09-19', 1, 'calendar_days', calendar), '2026-09-20');
  assert.equal(dueDate('2026-09-18', 1, 'working_days', { ...calendar, weekdays: [1, 2, 3, 4, 5] }), '2026-09-21');
  assert.equal(dueDate('2026-12-31', 1, 'calendar_days', calendar), '2027-01-01');
  assert.equal(dueDate('2024-02-28', 1, 'calendar_days', calendar), '2024-02-29');
});

test('deadline and calendar validation reject incomplete or nonsensical settings', () => {
  for (const days of [0, -1, 1.5, '2', NaN, 3651]) assert.throws(() => dueDate('2026-09-21', days, 'working_days', calendar), badRequest);
  assert.throws(() => dueDate('2026-02-31', 1, 'working_days', calendar), badRequest);
  assert.throws(() => dueDate('2026-09-21', 1, 'hourly', calendar), badRequest);
  for (const input of [{ weekdays: [] }, { weekdays: [7] }, { weekdays: ['1'] }, { holidays: ['2026-02-29'] }, { cutoff: '24:00' }, { cutoff: '5:00' }, { timezone: 'Not/AZone' }, { timezone: '+04:00' }]) {
    assert.throws(() => validateCalendar(input), badRequest);
  }
});

test('calendar normalization deduplicates without mutating the input', () => {
  const raw = { ...calendar, weekdays: [6, 1, 1], holidays: ['2026-12-25', '2026-01-01', '2026-12-25'] };
  assert.deepEqual(validateCalendar(raw), { ...calendar, weekdays: [1, 6], holidays: ['2026-01-01', '2026-12-25'] });
  assert.deepEqual(raw.weekdays, [6, 1, 1]);
});

test('plant date and cutoff use the configured timezone, independent of server timezone', () => {
  assert.equal(localDate('2026-09-20T21:00:00Z', 'Asia/Dubai'), '2026-09-21');
  assert.equal(localDate('2026-09-21T01:00:00Z', 'America/Los_Angeles'), '2026-09-20');
  assert.equal(localCutoffInstant('2026-09-21', '17:00', 'Asia/Dubai'), '2026-09-21T13:00:00.000Z');
  assert.equal(localCutoffInstant('2026-09-21', '17:00', 'Asia/Kathmandu'), '2026-09-21T11:15:00.000Z');
  assert.equal(localCutoffInstant('2026-09-20', '17:00', 'Asia/Dubai'), '2026-09-20T13:00:00.000Z');
});

test('DST conversion resolves ordinary dates and rejects nonexistent and repeated cutoff times', () => {
  assert.equal(localCutoffInstant('2026-01-15', '17:00', 'America/New_York'), '2026-01-15T22:00:00.000Z');
  assert.equal(localCutoffInstant('2026-07-15', '17:00', 'America/New_York'), '2026-07-15T21:00:00.000Z');
  assert.throws(() => localCutoffInstant('2026-03-08', '02:30', 'America/New_York'), error => badRequest(error) && /does not exist/.test(error.message));
  assert.throws(() => localCutoffInstant('2026-11-01', '01:30', 'America/New_York'), error => badRequest(error) && /ambiguous/.test(error.message));
  assert.throws(() => localCutoffInstant('2026-10-04', '02:15', 'Australia/Lord_Howe'), badRequest);
  assert.throws(() => localCutoffInstant('2011-12-30', '17:00', 'Pacific/Apia'), badRequest);
});

test('queue classification changes only after the exact cutoff instant', () => {
  const item = { state: 'open', timezone: 'Asia/Dubai', due_at: '2026-09-21T13:00:00.000Z' };
  assert.equal(classify(item, '2026-09-20T19:59:59Z'), 'upcoming');
  assert.equal(classify(item, '2026-09-20T20:00:00Z'), 'today');
  assert.equal(classify(item, '2026-09-21T13:00:00.000Z'), 'today');
  assert.equal(classify(item, '2026-09-21T13:00:00.001Z'), 'overdue');
  assert.equal(classify({ ...item, state: 'paused' }, '2026-09-22T13:00:00Z'), 'paused');
  assert.equal(classify({ ...item, setup_reason: 'No owner' }, '2026-09-22T13:00:00Z'), 'setup');
  assert.equal(classify({ ...item, due_at: null }), 'setup');
  assert.equal(classify({ ...item, due_at: 'bad' }), 'setup');
});

test('pause credit counts only complete eligible local dates, excluding both boundary dates', () => {
  assert.deepEqual(pauseCredit('2026-09-18T06:00:00Z', '2026-09-21T06:00:00Z', calendar), ['2026-09-19']);
  assert.deepEqual(pauseCredit('2026-09-21T04:00:00Z', '2026-09-21T12:00:00Z', calendar), []);
  assert.deepEqual(pauseCredit('2026-09-21', '2026-09-22', calendar), []);
  assert.deepEqual(pauseCredit('2026-09-18', '2026-09-23', { ...calendar, holidays: ['2026-09-21'] }), ['2026-09-19', '2026-09-22']);
  assert.throws(() => pauseCredit('2026-09-23', '2026-09-18', calendar), badRequest);
  assert.throws(() => pauseCredit('2026-09-21T12:00:00Z', '2026-09-21T04:00:00Z', calendar), badRequest);
  assert.throws(() => pauseCredit(null, '2026-09-21', calendar), badRequest);
});

test('pause boundaries are plant-local dates across a DST change', () => {
  const daily = { ...calendar, timezone: 'America/New_York', weekdays: [0, 1, 2, 3, 4, 5, 6] };
  assert.deepEqual(pauseCredit('2026-03-07T23:00:00Z', '2026-03-10T02:00:00Z', daily), ['2026-03-08']);
});
