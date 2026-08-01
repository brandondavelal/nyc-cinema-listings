'use strict';

const axios   = require('axios');
const { toISODate, normalizeTime } = require('../utils/dates');

const BASE    = 'https://lallianceny.org';
const URL     = `${BASE}/events/?_event_categories=film`;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

// "Tuesday, June 9, 2026" -> ISO date (year is explicit, no rollover needed)
function parseLongDate(raw) {
  const m = raw.match(/[A-Za-z]+,\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) return null;
  return toISODate(new Date(parseInt(m[3], 10), month, parseInt(m[2], 10)));
}

module.exports = async function scrapeLAlliance() {
  const { data: html } = await axios.get(URL, { headers: HEADERS, timeout: 20000 });
  const screenings = [];
  const seen = new Set();

  const cards = html.match(/<article class="[^"]*event-card"[^>]*>[\s\S]*?(?=<article class="[^"]*event-card"|<\/main|$)/g) || [];

  cards.forEach(card => {
    const titleM = card.match(/event-card__heading[^"]*"[^>]*>([\s\S]*?)<\/h3>/);
    if (!titleM) return;
    const title = titleM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/&#8211;/g, '–').replace(/&#8230;/g, '…').replace(/&#038;/g, '&');
    if (!title) return;

    // Single-date events only: "<p>Weekday, Month D, YYYY</p>" with no trailing date range
    const blockM = card.match(/brxe-psotcw[^>]*>(?:<div[^>]*>)?\s*<p[^>]*>([^<]+)<\/p>([\s\S]*?)event-card__excerpt/);
    if (!blockM) return;
    const dateText = blockM[1].trim();
    if (/\s-\s*[A-Za-z]+,/.test(dateText)) return; // skip date-range "series" cards
    const date = parseLongDate(dateText);
    if (!date) return;

    const linkM = card.match(/href="(https:\/\/lallianceny\.org\/event\/[^"]+)"/);
    const filmUrl = linkM ? linkM[1] : null;

    const imgM = card.match(/event-card__image[\s\S]*?<img[^>]*src="([^"]+)"/);
    const image = imgM ? imgM[1] : null;

    const times = [...blockM[2].matchAll(/>(\d{1,2}:\d{2}\s*[AP]M)</g)].map(m => m[1]);
    times.forEach(timeText => {
      const { display: time, sort: sortTime } = normalizeTime(timeText);
      const key = `${title}|${date}|${time}`;
      if (seen.has(key)) return;
      seen.add(key);

      screenings.push({
        theater: "L'Alliance New York", theaterKey: 'lalliance',
        title, date, time, sortTime,
        ticketUrl: filmUrl, filmUrl, image,
      });
    });
  });

  return screenings;
};
