'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const { getNextSevenDays, normalizeTime } = require('../utils/dates');

const BASE    = 'https://www.atomtickets.com';
const URL     = `${BASE}/theaters/paris-theater/19`;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

module.exports = async function scrapeParis() {
  const days = getNextSevenDays().slice(0, 14);
  const screenings = [];
  const seen = new Set();

  // Fetch a few days at a time to avoid hammering the server
  for (let i = 0; i < days.length; i += 3) {
    const chunk = days.slice(i, i + 3);
    await Promise.all(chunk.map(async date => {
      try {
        const { data } = await axios.get(`${URL}?date=${date}`, { headers: HEADERS, timeout: 20000 });
        const $ = cheerio.load(data);

        $('.showtime-panel').each((_, panelEl) => {
          const panel = $(panelEl);
          const titleLink = panel.find('h2 a').first();
          const title = titleLink.text().trim();
          if (!title) return;
          const filmUrl = titleLink.attr('href') ? BASE + titleLink.attr('href') : null;
          const image   = panel.find('img.poster').first().attr('data-src') || null;

          // Only real showtimes link to /checkout/ — links to other dates ("FridayJul 17")
          // appear when the film isn't actually playing on the requested date.
          panel.find('a.btn-showtime[href^="/checkout/"]').each((_, aEl) => {
            const link     = $(aEl);
            const timeText = link.text().trim();
            const ticketUrl = link.attr('href') ? BASE + link.attr('href') : null;
            if (!timeText) return;

            const { display: time, sort: sortTime } = normalizeTime(timeText);
            if (!sortTime) return;
            const key = `${title}|${date}|${time}`;
            if (seen.has(key)) return;
            seen.add(key);

            screenings.push({
              theater: 'Paris Theater', theaterKey: 'paris',
              title, date, time, sortTime,
              ticketUrl, filmUrl, image,
            });
          });
        });
      } catch { /* skip failed dates */ }
    }));
  }

  return screenings;
};
