'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const { toISODate, normalizeTime } = require('../utils/dates');

const BASE    = 'https://lowcinema.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

// Splits concatenated "Film Title7:30 PM" into { title, timeRaw }
function splitTitleTime(raw) {
  const m = raw.match(/^(.+?)(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))$/i);
  if (m) return { title: m[1].trim(), timeRaw: m[2].trim() };
  return { title: raw.trim(), timeRaw: null };
}

module.exports = async function scrapeLowCinema() {
  const { data } = await axios.get(`${BASE}/month/`, { headers: HEADERS, timeout: 15000 });
  const $ = cheerio.load(data);
  const screenings = [];
  const seen = new Set();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // The page is a monthly calendar table.
  // Each <td> is a day cell; the cell either has a date number or a data attribute.
  // Film links inside the cell go to /checkout/UUID/
  $('td, .day, [class*="calendar-day"]').each((_, cell) => {
    const cellEl = $(cell);

    // Extract the day number from the cell
    const dayNumEl = cellEl.find('.day-number, .date, [class*="day-num"]').first();
    const dayNumText = dayNumEl.length
      ? dayNumEl.text().trim()
      : cellEl.clone().children().remove().end().text().trim();

    const dayNum = parseInt(dayNumText);
    if (!dayNum || dayNum < 1 || dayNum > 31) return;

    // Infer full date: use current month, bump to next month if day < today's day
    const ref = new Date(today);
    ref.setDate(dayNum);
    if (ref < today) ref.setMonth(ref.getMonth() + 1, dayNum);
    const dateStr = toISODate(ref);

    // Each screening link: /checkout/UUID/
    cellEl.find('a[href*="/checkout/"]').each((_, aEl) => {
      const link       = $(aEl);
      const rawText    = link.text().trim();
      const ticketUrl  = BASE + link.attr('href');
      if (!rawText) return;

      const { title, timeRaw } = splitTitleTime(rawText);
      if (!title || !timeRaw) return;

      const { display: time, sort: sortTime } = normalizeTime(timeRaw);
      const key = `${title}|${dateStr}|${time}`;
      if (seen.has(key)) return;
      seen.add(key);

      screenings.push({
        theater: 'Low Cinema', theaterKey: 'lowcinema',
        title, date: dateStr, time, sortTime,
        ticketUrl, filmUrl: ticketUrl,
      });
    });
  });

  return screenings;
};
