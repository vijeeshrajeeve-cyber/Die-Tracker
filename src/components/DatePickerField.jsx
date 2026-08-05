import React, { useState, useRef, useEffect, useMemo, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import useDismissable from '../hooks/useDismissable';
import { BRAND } from '../utils/brand';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const POPOVER_WIDTH = 292;

const parseISODate = (str) => {
  if (!str) return null;
  const d = new Date(`${str}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const toISODateString = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// "June 01, 2025" — the format the field also accepts back as typed input.
const formatDisplay = (iso) => {
  const d = parseISODate(iso);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' });
};

/**
 * Parse what someone typed. Deliberately narrow: `new Date()` alone would read
 * "01/06/2025" as 6 January, and this app's users write dates day-first — so a
 * bare slash/dot form is rejected rather than silently misread. Accepted:
 * "June 01, 2025" (what the field prints back), "2025-06-01", and "1 June 2025".
 */
const parseTyped = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12);
    return d.getMonth() === Number(iso[2]) - 1 ? d : null;
  }

  // Month name in either order: "June 01, 2025" / "1 June 2025".
  const named = text.match(/^(?:(\d{1,2})\s+)?([A-Za-z]{3,})\.?,?\s*(?:(\d{1,2}),?\s*)?(\d{4})$/);
  if (named) {
    const [, dayBefore, monthWord, dayAfter, year] = named;
    const day = Number(dayBefore || dayAfter);
    if (!day) return null;
    const key = monthWord.toLowerCase();
    const month = MONTH_NAMES.findIndex((m) => m.toLowerCase().startsWith(key.slice(0, 3)));
    if (month < 0) return null;
    const d = new Date(Number(year), month, day, 12);
    return d.getMonth() === month && d.getDate() === day ? d : null;
  }

  return null;
};

const isSameDay = (a, b) =>
  a && b &&
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1, 12);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1, 12);

const DatePickerField = ({
  value = '',
  onChange,
  theme = {},
  disabled = false,
  title,
  label,
  // Most call sites render their own <label> above this field, styled to match
  // the form around them rather than the one below. Those pass `id` so their
  // label's htmlFor has something to point at; the generated id is only used
  // when nobody supplies one.
  id,
  // Forwarded to the text input. Used where the visible name is rendered by the
  // surrounding card rather than by a <label> this field could be paired with.
  'aria-label': ariaLabel,
  // For fields that appear in response to a click — an inline edit that replaces
  // a value with this picker — so the caret lands where the user is already
  // looking, as it does for the plain text and select editors beside it.
  autoFocus = false,
  placeholder = 'June 01, 2025',
}) => {
  const [open, setOpen] = useState(false);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
  const [viewDate, setViewDate] = useState(() => startOfMonth(parseISODate(value) || new Date()));
  // `draft` is the half-typed text and is null whenever the field is not being
  // edited. Deriving the displayed string from it — rather than mirroring
  // `value` into state through an effect — means an outside change to `value`
  // shows up on the next render with no cascade, and cannot overwrite what
  // someone is in the middle of typing.
  const [draft, setDraft] = useState(null);

  const containerRef = useRef(null);
  const calendarRef = useRef(null);
  const inputRef = useRef(null);
  const generatedId = useId();
  const inputId = id || generatedId;

  const selected = parseISODate(value);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }, []);

  const text = draft ?? formatDisplay(value);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, close, [containerRef, calendarRef]);

  const place = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Right-aligned to the field, like the reference's align="end".
    const left = Math.max(8, Math.min(rect.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - 8));
    const below = rect.bottom + 8;
    // Flip above when there is not enough room beneath.
    const top = below + 330 > window.innerHeight ? Math.max(8, rect.top - 338) : below;
    setPopupPos({ top, left });
  }, []);

  // Only listener wiring lives in the effect; the first measurement happens in
  // the click handler below, where the trigger is already on screen. A picker
  // inside a scrolling modal used to detach from its field, because the
  // position was measured once and never again.
  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const openPicker = () => {
    if (disabled) return;
    setViewDate(startOfMonth(selected || new Date()));
    place();
    setOpen(true);
  };

  const pickDate = (date) => {
    onChange(toISODateString(date));
    setDraft(null);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onType = (e) => {
    const next = e.target.value;
    setDraft(next);
    if (!next.trim()) {
      onChange('');
      return;
    }
    const parsed = parseTyped(next);
    if (parsed) {
      onChange(toISODateString(parsed));
      setViewDate(startOfMonth(parsed));
    }
  };

  // Unparseable text snaps back to the committed value rather than being left
  // on screen looking saved.
  const onBlurInput = () => setDraft(null);

  // Weeks are filled out with the neighbouring months' days, so the grid always
  // ends on a Saturday instead of trailing off mid-row.
  const weeks = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const lead = new Date(year, month, 1, 12).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = lead; i > 0; i -= 1) cells.push({ date: new Date(year, month, 1 - i, 12), outside: true });
    for (let d = 1; d <= daysInMonth; d += 1) cells.push({ date: new Date(year, month, d, 12), outside: false });
    // `cells.length % 7` cannot be the day offset here — it changes on every
    // iteration, which skipped the 1st of the next month and shifted the rest.
    let trail = 1;
    while (cells.length % 7 !== 0) {
      cells.push({ date: new Date(year, month, daysInMonth + trail, 12), outside: true });
      trail += 1;
    }
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [viewDate]);

  const border = theme.cardBorder || '#27272a';
  const fieldBg = theme.inputBg || '#18181b';
  const surface = theme.cardBg || '#131316';
  const text_ = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const primary = theme.primary || BRAND.navy;
  const primaryFg = theme.primaryText || '#ffffff';

  const ghostBtn = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, borderRadius: 8,
    background: 'transparent', border: `1px solid ${border}`,
    color: muted, cursor: 'pointer', flexShrink: 0,
  };

  return (
    // Escape means "close the calendar" whenever it is open, and nothing more —
    // a caller that treats Escape as "cancel this edit" must not also tear the
    // field down on the keypress that only dismissed its popover. Handled here
    // rather than on the input because focus may be on a day inside the calendar,
    // which portals to the body but still bubbles through this React subtree.
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return;
        e.stopPropagation();
        setOpen(false);
        setDraft(null);
        inputRef.current?.focus();
      }}>
      {label && (
        <label
          htmlFor={inputId}
          style={{
            display: 'block', marginBottom: 6, fontSize: 12.5,
            fontWeight: 550, color: text_, letterSpacing: '-0.005em',
          }}
        >
          {label}
        </label>
      )}

      {/* Input group: the field and its trigger share one border, with the
          calendar button sitting inside as a ghost addon. */}
      <div
        title={title}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          width: '100%', paddingRight: 5,
          borderRadius: 10,
          border: `1px solid ${border}`,
          background: fieldBg,
          opacity: disabled ? 0.6 : 1,
          transition: 'border-color 140ms ease',
        }}
      >
        <input
          id={inputId}
          aria-label={ariaLabel}
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoFocus={autoFocus}
          disabled={disabled}
          value={text}
          placeholder={placeholder}
          onChange={onType}
          onBlur={onBlurInput}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              openPicker();
            }
          }}
          style={{
            flex: 1, minWidth: 0,
            padding: '9px 4px 9px 12px',
            background: 'transparent', border: 'none', outline: 'none',
            color: text_, fontSize: 13.5, lineHeight: 1.4,
            cursor: disabled ? 'not-allowed' : 'text',
          }}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openPicker())}
          aria-label="Select date"
          aria-haspopup="dialog"
          aria-expanded={open}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: 7,
            background: 'transparent', border: 'none',
            color: muted, cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0,
          }}
        >
          <CalendarIcon size={15} />
        </button>
      </div>

      {open && !disabled && createPortal(
        <div
          ref={calendarRef}
          role="dialog"
          aria-label="Choose date"
          style={{
            position: 'fixed',
            top: popupPos.top,
            left: popupPos.left,
            zIndex: 10002,
            width: POPOVER_WIDTH,
            padding: 12,
            background: surface,
            border: `1px solid ${border}`,
            borderRadius: 12,
            boxShadow: theme.shadowLg || '0 16px 40px rgba(0,0,0,0.45)',
            animation: 'dpPopIn 0.16s cubic-bezier(0.32,0.72,0,1)',
          }}
        >
          {/* Month navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setViewDate((d) => addMonths(d, -1))}
              style={ghostBtn}
              aria-label="Previous month"
            >
              <ChevronLeft size={15} />
            </button>
            <span aria-live="polite" style={{ fontSize: 13.5, fontWeight: 600, color: text_, letterSpacing: '-0.01em' }}>
              {MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setViewDate((d) => addMonths(d, 1))}
              style={ghostBtn}
              aria-label="Next month"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {WEEKDAYS.map((wd) => (
                  <th
                    key={wd}
                    scope="col"
                    abbr={wd}
                    style={{
                      padding: '4px 0', fontSize: 11.5, fontWeight: 400,
                      color: dim, textAlign: 'center',
                    }}
                  >
                    {wd}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0].date.toISOString()}>
                  {week.map(({ date, outside }) => {
                    const isSelected = isSameDay(date, selected);
                    const isToday = isSameDay(date, today);
                    return (
                      <td key={date.toISOString()} style={{ padding: 1, textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => pickDate(date)}
                          aria-label={date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                          aria-current={isToday ? 'date' : undefined}
                          aria-selected={isSelected}
                          style={{
                            width: 34, height: 34, borderRadius: 8,
                            border: 'none',
                            fontSize: 13, fontVariantNumeric: 'tabular-nums',
                            fontWeight: isSelected ? 600 : 400,
                            cursor: 'pointer',
                            background: isSelected ? primary : 'transparent',
                            // Outside days stay reachable but recede, so the
                            // current month reads as the subject of the grid.
                            color: isSelected ? primaryFg : outside ? dim : text_,
                            opacity: outside && !isSelected ? 0.55 : 1,
                            // Today is marked with a ring rather than a fill, so
                            // it never competes with the selected day.
                            boxShadow: isToday && !isSelected ? `inset 0 0 0 1px ${border}` : 'none',
                          }}
                        >
                          {date.getDate()}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div
            style={{
              display: 'flex', justifyContent: 'space-between', gap: 8,
              marginTop: 10, paddingTop: 10, borderTop: `1px solid ${border}`,
            }}
          >
            <button
              type="button"
              onClick={() => pickDate(today)}
              style={{
                padding: '5px 10px', borderRadius: 7, border: 'none',
                background: 'transparent', color: muted,
                fontSize: 12, fontWeight: 550, cursor: 'pointer',
              }}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => {
                onChange('');
                setDraft(null);
                setOpen(false);
              }}
              style={{
                padding: '5px 10px', borderRadius: 7, border: 'none',
                background: 'transparent', color: muted,
                fontSize: 12, fontWeight: 550, cursor: 'pointer',
              }}
            >
              Clear
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default DatePickerField;
