'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { parseLongDate, normalizeTime } = require('../utils/dates');

const BASE_URL = 'https://thecinematheque.ca';
const CALENDAR_URL = `${BASE_URL}/films/calendar`;
const THEATER = 'The Cinematheque';
const THEATER_KEY = 'cinematheque';

const DAY_RE = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i;

async function fetchWithRetry(url, options, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, options);
    } catch (err) {
      const status = err.response?.status;
      if (i < retries - 1 && (status === 503 || status === 429 || !status)) {
        await new Promise(r => setTimeout(r, delay * (i + 1)));
        continue;
      }
      throw err;
    }
  }
}

module.exports = async function scrapeCinemathque() {
  const { data } = await fetchWithRetry(CALENDAR_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    timeout: 15000,
  });

  const $ = cheerio.load(data);
  const screenings = [];

  // Calendar is a nested list: parent <li> contains the date as text,
  // with a nested <ul>/<ol> of film entries.
  // Film entry: <li><a>HH:MM</a> [<a>Tickets</a>] <a>Film Title</a></li>

  $('li').each((_, el) => {
    const el$ = $(el);

    // Extract the direct text of this element (excluding nested lists)
    const ownText = el$.clone().children('ul, ol').remove().end().text().trim();
    if (!DAY_RE.test(ownText)) return;

    const dateStr = parseLongDate(ownText);
    if (!dateStr) return;

    // Film entries are in the direct child list
    el$.find('> ul > li, > ol > li').each((_, filmEl) => {
      const links = $(filmEl).find('a');
      if (links.length < 1) return;

      let timeDisplay = null;
      let sortTime = 0;
      let title = null;
      let filmUrl = null;
      let ticketUrl = null;

      links.each((_, link) => {
        const link$ = $(link);
        const text = link$.text().trim();
        const href = link$.attr('href') || '';
        const fullHref = href.startsWith('http') ? href : `${BASE_URL}${href}`;

        if (/^\d{1,2}:\d{2}$/.test(text)) {
          const t = normalizeTime(text);
          timeDisplay = t.display;
          sortTime = t.sort;
        } else if (/^ticket/i.test(text)) {
          ticketUrl = fullHref;
        } else if (text.length > 1 && title === null) {
          title = text;
          filmUrl = fullHref;
        }
      });

      if (timeDisplay && title) {
        screenings.push({ theater: THEATER, theaterKey: THEATER_KEY, title, date: dateStr, time: timeDisplay, sortTime, ticketUrl, filmUrl });
      }
    });
  });

  return screenings;
};
