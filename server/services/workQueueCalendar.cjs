'use strict';

const DAY_MS = 86400000;
const DEFAULT_TIMEZONE = 'Asia/Dubai';
const formatters = new Map();

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.statusCode = 400;
  return error;
}

function utcDate(year, month, day, hour = 0, minute = 0, second = 0) {
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(hour, minute, second, 0);
  return value;
}

function strictDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = utcDate(year, month, day);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? value : null;
}

function formatter(timezone) {
  if (typeof timezone !== 'string' || !timezone.trim() || /^[+-]/.test(timezone)) {
    throw invalid('Choose a valid IANA timezone');
  }
  if (!formatters.has(timezone)) {
    try {
      const value = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, calendar: 'gregory', numberingSystem: 'latn',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      });
      if (formatters.size > 100) formatters.clear();
      formatters.set(timezone, value);
    } catch {
      throw invalid('Choose a valid IANA timezone');
    }
  }
  return formatters.get(timezone);
}

function parts(instant, timezone) {
  if (instant == null || instant === '') throw invalid('Invalid timestamp');
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) throw invalid('Invalid timestamp');
  return Object.fromEntries(formatter(timezone).formatToParts(date)
    .filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}

function localDate(now, timezone = DEFAULT_TIMEZONE) {
  const value = parts(now, timezone);
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}

function validateCalendar(calendar = {}) {
  if (!calendar || typeof calendar !== 'object' || Array.isArray(calendar)) throw invalid('Invalid working calendar');
  const timezone = calendar.timezone ?? DEFAULT_TIMEZONE;
  const normalizedTimezone = formatter(timezone).resolvedOptions().timeZone;
  const weekdays = calendar.weekdays ?? [1, 2, 3, 4, 5, 6];
  if (!Array.isArray(weekdays) || !weekdays.length || !weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6)) {
    throw invalid('Working days must contain at least one weekday from 0 to 6');
  }
  const holidays = calendar.holidays ?? [];
  if (!Array.isArray(holidays) || !holidays.every(day => strictDate(day))) throw invalid('Holidays must be valid YYYY-MM-DD dates');
  const cutoff = calendar.cutoff ?? '17:00';
  if (typeof cutoff !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) throw invalid('Cutoff must be HH:MM in 24-hour time');
  return { timezone: normalizedTimezone, weekdays: [...new Set(weekdays)].sort(), holidays: [...new Set(holidays)].sort(), cutoff };
}

function dateNumber(value) {
  if (!strictDate(value)) throw invalid('Expected a valid YYYY-MM-DD date');
  return utcDate(...value.split('-').map(Number)).getTime();
}

function isoDay(timestamp) {
  const result = new Date(timestamp).toISOString().slice(0, 10);
  if (!strictDate(result)) throw invalid('Date calculation is outside the supported range');
  return result;
}

function dueDate(entryDate, days, mode = 'working_days', calendar = {}) {
  let cursor = dateNumber(entryDate);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw invalid('Deadline target must be 1 to 3650 whole days');
  const rule = validateCalendar(calendar);
  const calendarDays = mode === 'calendar_days' || mode === 'calendar';
  if (!calendarDays && mode !== 'working_days' && mode !== 'working') throw invalid('Deadline mode must be working_days or calendar_days');
  if (calendarDays) return isoDay(cursor + days * DAY_MS);
  const holidays = new Set(rule.holidays);
  for (let count = 0; count < days;) {
    cursor += DAY_MS;
    const day = isoDay(cursor);
    if (rule.weekdays.includes(new Date(cursor).getUTCDay()) && !holidays.has(day)) count++;
  }
  return isoDay(cursor);
}

// Offset candidates are sampled on both sides of the requested local time.
// Every candidate must round-trip exactly: a DST gap has zero matches and a
// repeated local time has two. Neither gets silently moved or guessed.
function localCutoffInstant(date, cutoff = '17:00', timezone = DEFAULT_TIMEZONE) {
  dateNumber(date);
  validateCalendar({ timezone, cutoff });
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = cutoff.split(':').map(Number);
  const wall = utcDate(year, month, day, hour, minute).getTime();
  const offsets = new Set();
  for (let hours = -48; hours <= 48; hours += 3) {
    const probe = wall + hours * 3600000;
    const p = parts(probe, timezone);
    offsets.add(utcDate(p.year, p.month, p.day, p.hour, p.minute, p.second).getTime() - probe);
  }
  const matches = [...offsets].map(offset => wall - offset).filter(candidate => {
    const p = parts(candidate, timezone);
    return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute && p.second === 0;
  });
  if (matches.length !== 1) throw invalid(matches.length ? 'Cutoff is ambiguous in this timezone on this date' : 'Cutoff does not exist in this timezone on this date');
  return new Date(matches[0]).toISOString();
}

function classify(item, now = new Date()) {
  if (item?.state === 'paused') return 'paused';
  if (item?.setup_reason || !item?.due_at) return 'setup';
  const due = new Date(item.due_at);
  const current = new Date(now);
  if (!Number.isFinite(due.getTime())) return 'setup';
  if (!Number.isFinite(current.getTime())) throw invalid('Invalid timestamp');
  if (current.getTime() > due.getTime()) return 'overdue';
  const timezone = item.timezone || DEFAULT_TIMEZONE;
  return localDate(due, timezone) === localDate(current, timezone) ? 'today' : 'upcoming';
}

function pauseCredit(startAt, endAt, calendar = {}) {
  const rule = validateCalendar(calendar);
  const start = strictDate(startAt) || localDate(startAt, rule.timezone);
  const end = strictDate(endAt) || localDate(endAt, rule.timezone);
  const from = dateNumber(start);
  const to = dateNumber(end);
  if (to < from || (!strictDate(startAt) && !strictDate(endAt) && new Date(endAt) < new Date(startAt))) throw invalid('Resume date cannot precede the pause date');
  const holidays = new Set(rule.holidays);
  const dates = [];
  for (let cursor = from + DAY_MS; cursor < to; cursor += DAY_MS) {
    const date = isoDay(cursor);
    if (rule.weekdays.includes(new Date(cursor).getUTCDay()) && !holidays.has(date)) dates.push(date);
  }
  return dates;
}

module.exports = { strictDate, localDate, dueDate, localCutoffInstant, classify, pauseCredit, validateCalendar };
