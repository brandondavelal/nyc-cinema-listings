'use strict';

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7,
  sep: 8, oct: 9, nov: 10, dec: 11,
};

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getNextSevenDays() {
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(toISODate(d));
  }
  return days;
}

// Parse "Sunday 31 May 2026" or "Wednesday 3 June 2026"
function parseLongDate(text) {
  const cleaned = text.replace(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+/i, '').trim();
  // "31 May 2026" or "3 June 2026"
  const match = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;
  const day = parseInt(match[1]);
  const month = MONTHS[match[2].toLowerCase()];
  const year = parseInt(match[3]);
  if (month === undefined) return null;
  return toISODate(new Date(year, month, day));
}

// Parse "Tue Jun 2" or "Mon Jun 3" — uses current year
function parseShortDate(text) {
  // "Tue Jun 2" → strip day name
  const cleaned = text.replace(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+/i, '').trim();
  // "Jun 2" or "Jun 12"
  const match = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (month === undefined) return null;
  const day = parseInt(match[2]);
  const year = new Date().getFullYear();
  return toISODate(new Date(year, month, day));
}

// Parse "Jun 2, 2026" or "June 2, 2026"
function parseMediumDate(text) {
  const match = text.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (month === undefined) return null;
  return toISODate(new Date(parseInt(match[3]), month, parseInt(match[2])));
}

// Normalize a time string to { display: "7:30 PM", sort: minutes-since-midnight }
// Assumes cinema times with no AM/PM marker are PM
function normalizeTime(raw) {
  const str = (raw || '').trim();
  const match = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return { display: str, sort: 0 };

  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const ampm = match[4]?.toLowerCase();

  if (ampm === 'am') {
    if (h === 12) h = 0;
  } else if (ampm === 'pm') {
    if (h !== 12) h += 12;
  } else {
    // No explicit marker — cinema heuristic: treat as PM
    if (h < 12) h += 12;
  }

  const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const displayPeriod = h >= 12 ? 'PM' : 'AM';
  return {
    display: `${displayH}:${String(m).padStart(2, '0')} ${displayPeriod}`,
    sort: h * 60 + m,
  };
}

module.exports = { toISODate, getNextSevenDays, parseLongDate, parseShortDate, parseMediumDate, normalizeTime };
