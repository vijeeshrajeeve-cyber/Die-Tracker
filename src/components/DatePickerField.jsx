import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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

const formatDisplay = (iso) => {
  const d = parseISODate(iso);
  if (!d) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const isSameDay = (a, b) =>
  a && b &&
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const DatePickerField = ({
  value = '',
  onChange,
  theme = {},
  disabled = false,
  title,
  placeholder = 'Select date',
}) => {
  const [open, setOpen] = useState(false);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
  const [viewDate, setViewDate] = useState(() => parseISODate(value) || new Date());
  const containerRef = useRef(null);
  const calendarRef = useRef(null);

  const selected = parseISODate(value);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }, []);

  useEffect(() => {
    if (value) setViewDate(parseISODate(value) || new Date());
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e) => {
      const inTrigger = containerRef.current?.contains(e.target);
      const inCalendar = calendarRef.current?.contains(e.target);
      if (!inTrigger && !inCalendar) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const calendarDays = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstOfMonth = new Date(year, month, 1, 12, 0, 0, 0);
    const startOffset = firstOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];

    for (let i = 0; i < startOffset; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(new Date(year, month, day, 12, 0, 0, 0));
    }
    return cells;
  }, [viewDate]);

  const openPicker = () => {
    if (disabled) return;
    setViewDate(selected || new Date());
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 280;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const top = rect.bottom + 6;
      const maxTop = window.innerHeight - 340;
      setPopupPos({ top: Math.min(top, maxTop), left });
    }
    setOpen(true);
  };

  const pickDate = (date) => {
    onChange(toISODateString(date));
    setOpen(false);
  };

  const border = theme.cardBorder || '#27272a';
  const bg = theme.inputBg || '#09090b';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const accent = '#3b82f6';

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          width: '100%',
          borderRadius: '10px',
          border: `1px solid ${border}`,
          background: disabled ? `${bg}99` : bg,
          opacity: disabled ? 0.65 : 1,
          overflow: 'hidden',
        }}
        title={title}
      >
        <button
          type="button"
          disabled={disabled}
          onClick={openPicker}
          style={{
            flex: 1,
            padding: '10px 14px',
            background: 'transparent',
            border: 'none',
            color: value ? text : muted,
            fontSize: '0.875rem',
            textAlign: 'left',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          {value ? formatDisplay(value) : placeholder}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={openPicker}
          aria-label="Open calendar"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 12px',
            background: 'transparent',
            border: 'none',
            borderLeft: `1px solid ${border}`,
            color: muted,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          <Calendar size={18} />
        </button>
      </div>

      {open && !disabled && createPortal(
        <div
          ref={calendarRef}
          style={{
            position: 'fixed',
            top: popupPos.top,
            left: popupPos.left,
            zIndex: 2000,
            width: '280px',
            padding: '12px',
            background: theme.cardBg || '#18181b',
            border: `1px solid ${border}`,
            borderRadius: '12px',
            boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <button
              type="button"
              onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1, 12, 0, 0, 0))}
              style={navBtnStyle}
              aria-label="Previous month"
            >
              <ChevronLeft size={18} />
            </button>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: text }}>
              {MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1, 12, 0, 0, 0))}
              style={navBtnStyle}
              aria-label="Next month"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
            {WEEKDAYS.map((wd) => (
              <span
                key={wd}
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  color: dim,
                  textAlign: 'center',
                  padding: '4px 0',
                }}
              >
                {wd}
              </span>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
            {calendarDays.map((day, idx) => (
              <span key={idx} style={{ aspectRatio: '1', display: 'flex' }}>
                {day ? (
                  <button
                    type="button"
                    onClick={() => pickDate(day)}
                    style={{
                      flex: 1,
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: isSameDay(day, selected) ? 700 : 500,
                      cursor: 'pointer',
                      background: isSameDay(day, selected)
                        ? accent
                        : isSameDay(day, today)
                          ? 'rgba(59,130,246,0.15)'
                          : 'transparent',
                      color: isSameDay(day, selected) ? '#fff' : text,
                    }}
                  >
                    {day.getDate()}
                  </button>
                ) : null}
              </span>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '8px',
              marginTop: '10px',
              paddingTop: '10px',
              borderTop: `1px solid ${border}`,
            }}
          >
            <button
              type="button"
              onClick={() => pickDate(today)}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: '8px',
                border: `1px solid ${border}`,
                background: 'transparent',
                color: accent,
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: '8px',
                border: `1px solid ${border}`,
                background: 'transparent',
                color: muted,
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
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

const navBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '4px',
  background: 'transparent',
  border: 'none',
  borderRadius: '6px',
  color: '#a1a1aa',
  cursor: 'pointer',
};

export default DatePickerField;
