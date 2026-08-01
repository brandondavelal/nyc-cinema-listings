'use strict';

const axios = require('axios');
const { toISODate, normalizeTime } = require('../utils/dates');

const ICAL_URL = 'https://movingimage.org/?post_type=tribe_events&tribe_filterbar_category_custom%5B0%5D=230&ical=1&eventDisplay=list';
const HEADERS  = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

// Unescape iCalendar TEXT values: "\," -> ",", "\;" -> ";", "\n"/"\N" -> space, "\\" -> "\"
function unescapeText(raw) {
  return String(raw)
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .replace(/\s+/g, ' ')
    .trim();
}

// "DTSTART;TZID=America/New_York:20260612T190000" -> { date: "2026-06-12", time: "7:00 PM", sortTime }
function parseStart(raw) {
  const m = raw.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, min] = m;
  const date = toISODate(new Date(parseInt(y), parseInt(mo) - 1, parseInt(d)));
  const { display: time, sort: sortTime } = normalizeTime(`${h}:${min}`);
  return { date, time, sortTime };
}

// Field lines look like "NAME;PARAM=...:VALUE" or "NAME:VALUE" — split on the first colon
// that isn't inside the parameter section.
function splitField(line) {
  const i = line.indexOf(':');
  if (i === -1) return null;
  return { name: line.slice(0, i), value: line.slice(i + 1) };
}

// Description bodies follow "Dir. NAME. YEAR, RUNTIME mins. ..." — pull those out when present.
function parseFilmInfo(description) {
  const m = description.match(/^Dir\.\s*([^.]+)\.\s*(\d{4}),\s*(\d+)\s*mins?\b/i);
  if (!m) return { director: null, year: null, runtime: null };
  return { director: m[1].trim(), year: m[2], runtime: `${m[3]} min` };
}

module.exports = async function scrapeMoMI() {
  const { data } = await axios.get(ICAL_URL, { headers: HEADERS, timeout: 20000 });
  if (typeof data !== 'string') return [];

  const screenings = [];
  const seen = new Set();
  const blocks = data.split('BEGIN:VEVENT').slice(1);

  for (const block of blocks) {
    const body = block.split('END:VEVENT')[0];
    const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    let dtstart = null, summary = null, description = null, url = null, image = null;
    for (const line of lines) {
      const field = splitField(line);
      if (!field) continue;
      const name = field.name.split(';')[0].toUpperCase();
      if (name === 'DTSTART') dtstart = field.value;
      else if (name === 'SUMMARY') summary = unescapeText(field.value);
      else if (name === 'DESCRIPTION') description = unescapeText(field.value);
      else if (name === 'URL') url = field.value.trim();
      else if (name === 'ATTACH') image = field.value.trim();
    }
    if (!dtstart || !summary) continue;

    const start = parseStart(dtstart);
    if (!start) continue;

    const key = `${summary}|${start.date}|${start.time}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { director, year, runtime } = description ? parseFilmInfo(description) : { director: null, year: null, runtime: null };

    screenings.push({
      theater: 'Museum of the Moving Image', theaterKey: 'momi',
      title: summary, date: start.date, time: start.time, sortTime: start.sortTime,
      ticketUrl: url || null, filmUrl: url || null,
      image: image || null,
      description: description || null,
      director, year, runtime,
    });
  }

  return screenings;
};
