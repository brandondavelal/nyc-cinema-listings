'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const { toISODate, normalizeTime } = require('../utils/dates');
const { toTitleCase } = require('../utils/text');

const BASE    = 'https://filmforum.org';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

// #tabs-0..#tabs-6 in the "Playing This Week" module correspond to SUN..SAT
// of the current week — compute each tab's calendar date relative to today.
module.exports = async function scrapeFilmForum() {
  const { data } = await axios.get(`${BASE}/now_playing`, { headers: HEADERS, timeout: 20000 });
  const $ = cheerio.load(data);
  const screenings = [];
  const seen = new Set();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayDow = today.getDay();

  for (let dow = 0; dow <= 6; dow++) {
    const tab = $(`#tabs-${dow}`);
    if (!tab.length) continue;

    let delta = dow - todayDow;
    if (delta < 0) delta += 7;
    const date = new Date(today);
    date.setDate(today.getDate() + delta);
    const dateStr = toISODate(date);

    tab.find('p').each((_, pEl) => {
      const p = $(pEl);
      const titleLink = p.find('strong a').first();
      const rawTitle  = titleLink.text().trim();
      if (!rawTitle || /showtimes coming soon/i.test(rawTitle)) return;
      const title = toTitleCase(rawTitle);

      const href = titleLink.attr('href');
      const filmUrl = href ? (href.startsWith('http') ? href : BASE + href) : null;

      p.find('span').each((_, sEl) => {
        const timeText = $(sEl).text().trim();
        if (!timeText) return;

        const { display: time, sort: sortTime } = normalizeTime(timeText);
        const key = `${title}|${dateStr}|${time}`;
        if (seen.has(key)) return;
        seen.add(key);

        screenings.push({
          theater: 'Film Forum', theaterKey: 'filmforum',
          title, date: dateStr, time, sortTime,
          ticketUrl: filmUrl, filmUrl, image: null,
        });
      });
    });
  }

  return screenings;
};
