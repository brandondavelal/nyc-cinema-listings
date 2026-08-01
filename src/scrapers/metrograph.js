'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const { normalizeTime } = require('../utils/dates');

const BASE    = 'https://metrograph.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

// "Hong Sangsoo / 2014 / 66min / DCP" -> { director, year, runtime, format }
function parseMetadata(raw) {
  const m = raw.match(/^(.+?)\s*\/\s*(\d{4})\s*\/\s*(\d{2,3})\s*min\s*\/\s*(.+)$/i);
  if (!m) return {};
  return {
    director: m[1].replace(/\s+/g, ' ').trim(),
    year:     m[2],
    runtime:  `${m[3]} min`,
    format:   m[4].trim(),
  };
}

module.exports = async function scrapeMetrograph() {
  const { data } = await axios.get(`${BASE}/nyc/`, { headers: HEADERS, timeout: 20000 });
  const $ = cheerio.load(data);
  const screenings = [];
  const seen = new Set();

  // The page embeds a hidden div per upcoming date (#calendar-list-day-YYYY-MM-DD)
  // containing that day's actual lineup; client-side JS just shows/hides them.
  // Scraping these directly avoids re-requesting per ?date= (which the server ignores).
  $('[id^="calendar-list-day-"]').each((_, dayEl) => {
    const dayDiv = $(dayEl);
    const id = dayDiv.attr('id');
    const m  = id.match(/^calendar-list-day-(\d{4}-\d{2}-\d{2})$/);
    if (!m) return;
    const date = m[1];

    dayDiv.find('.item.film-thumbnail').each((_, itemEl) => {
      const item = $(itemEl);
      const titleLink = item.find('h4 a[href*="vista_film_id"]').first();
      const title = titleLink.text().trim();
      if (!title) return;
      const filmUrl = titleLink.attr('href') ? BASE + titleLink.attr('href') : null;
      const image   = item.find('a.image img').first().attr('src') || null;
      const meta    = parseMetadata(item.find('.film-metadata').first().text().trim());

      item.find('.showtimes a[href*="txtSessionId"]').each((_, sEl) => {
        const sLink     = $(sEl);
        const timeText  = sLink.text().trim();
        const ticketUrl = sLink.attr('href') || null;
        if (!timeText) return;

        const { display: time, sort: sortTime } = normalizeTime(timeText);
        const key = `${title}|${date}|${time}`;
        if (seen.has(key)) return;
        seen.add(key);

        screenings.push({
          theater: 'Metrograph', theaterKey: 'metrograph',
          title, date, time, sortTime,
          ticketUrl, filmUrl, image,
          director: meta.director || null,
          year:     meta.year || null,
          runtime:  meta.runtime || null,
        });
      });
    });
  });

  return screenings;
};
