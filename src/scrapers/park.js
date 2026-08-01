'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { parseShortDate, normalizeTime } = require('../utils/dates');

const BASE_URL = 'https://www.theparktheatre.ca';
const THEATER = 'Park Theatre';
const THEATER_KEY = 'park';

module.exports = async function scrapePark() {
  const { data } = await axios.get(BASE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    timeout: 15000,
  });

  const $ = cheerio.load(data);
  const screenings = [];

  // Park Theatre uses event cards — each card has a date, time, and title.
  // Collect all anchor elements that look like event cards (wrap an image + text).
  // Also look for standalone date+time patterns in the page.

  // Strategy: walk all <a> elements that contain both a date-like text and a time-like text
  // The page structure is likely: <a href="/film/..."><img...><div class="date">Tue Jun 2</div><div class="time">4:00 pm</div><h3>Title</h3></a>
  // or similar card patterns.

  // We look for any element containing a date (e.g. "Tue Jun 2") and time (e.g. "4:00 pm")
  // grouped together, and extract the nearest title.

  const SHORT_DATE_RE = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}$/i;
  const TIME_RE = /^\d{1,2}:\d{2}\s*(am|pm)$/i;

  // Collect all text leaf nodes with their parent containers
  const cards = [];

  // Try: each <a> that links to a film page and contains date+time text
  $('a[href]').each((_, el) => {
    const el$ = $(el);
    const text = el$.text();
    const href = el$.attr('href') || '';

    // Look for date and time patterns in the text
    const dateMatch = text.match(/((?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})/i);
    const timeMatch = text.match(/(\d{1,2}:\d{2}\s*(?:am|pm))/i);

    if (!dateMatch || !timeMatch) return;

    const dateStr = parseShortDate(dateMatch[1]);
    if (!dateStr) return;

    const { display: timeDisplay, sort: sortTime } = normalizeTime(timeMatch[1].trim());

    // Extract title: the film name is usually in an <h2>, <h3>, or similar heading,
    // or it's the meaningful text after removing date/time
    let title = null;
    el$.find('h1, h2, h3, h4, .title, .film-title, [class*="title"]').each((_, h) => {
      const t = $(h).text().trim();
      if (t.length > 2 && !SHORT_DATE_RE.test(t) && !TIME_RE.test(t)) {
        title = title || t;
      }
    });

    // Fallback: strip date and time from full text to get title
    if (!title) {
      const stripped = text
        .replace(dateMatch[1], '')
        .replace(timeMatch[1], '')
        .replace(/\s+/g, ' ')
        .trim();
      if (stripped.length > 2) title = stripped;
    }

    if (!title) return;

    const fullHref = href.startsWith('http') ? href : `${BASE_URL}${href}`;
    cards.push({ title, dateStr, timeDisplay, sortTime, filmUrl: fullHref });
  });

  // Deduplicate (same title + date + time)
  const seen = new Set();
  for (const c of cards) {
    const key = `${c.title}|${c.dateStr}|${c.timeDisplay}`;
    if (seen.has(key)) continue;
    seen.add(key);
    screenings.push({
      theater: THEATER,
      theaterKey: THEATER_KEY,
      title: c.title,
      date: c.dateStr,
      time: c.timeDisplay,
      sortTime: c.sortTime,
      ticketUrl: null,
      filmUrl: c.filmUrl,
    });
  }

  return screenings;
};
