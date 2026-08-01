'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const { toISODate, normalizeTime } = require('../utils/dates');

const BASE    = 'https://www.ifccenter.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

const DOW_NAME = { sat:6, sun:0, mon:1, tue:2, wed:3, thu:4, fri:5 };

module.exports = async function scrapeIFC() {
  const { data } = await axios.get(`${BASE}/`, { headers: HEADERS, timeout: 15000 });
  const $ = cheerio.load(data);
  const screenings = [];
  const seen = new Set();

  const today    = new Date();
  today.setHours(0, 0, 0, 0);
  const todayDow = today.getDay(); // 0=Sun

  // div.daily-schedule.{dow} — one section per day of the week
  $('[class*="daily-schedule"]').each((_, schedEl) => {
    const cls = $(schedEl).attr('class') || '';
    // Find which day this section is for
    const dowEntry = Object.entries(DOW_NAME).find(([name]) => cls.includes(name));
    if (!dowEntry) return;
    const [, dowNum] = dowEntry;

    // Calculate the actual calendar date for this DOW
    let delta = dowNum - todayDow;
    if (delta < 0) delta += 7;
    const date = new Date(today);
    date.setDate(today.getDate() + delta);
    const dateStr = toISODate(date);

    // Each film: li > div.details > h3 > a (title) + ul.times > li > a (ticket+time)
    $(schedEl).find('li').each((_, liEl) => {
      const li      = $(liEl);
      const details = li.children('div.details');
      if (!details.length) return;

      const titleLinkEl = details.find('h3 a').first();
      const title = titleLinkEl.text().trim();
      if (!title) return;

      const filmUrl = titleLinkEl.length
        ? (titleLinkEl.attr('href').startsWith('http') ? titleLinkEl.attr('href') : BASE + titleLinkEl.attr('href'))
        : null;

      details.find('ul.times li a').each((_, aEl) => {
        const link      = $(aEl);
        const timeRaw   = link.text().trim();
        const ticketUrl = link.attr('href') ? link.attr('href').trim() : null;
        if (!timeRaw) return;

        const { display: time, sort: sortTime } = normalizeTime(timeRaw);
        const key = `${title}|${dateStr}|${time}`;
        if (seen.has(key)) return;
        seen.add(key);

        screenings.push({
          theater: 'IFC Center', theaterKey: 'ifc',
          title, date: dateStr, time, sortTime,
          ticketUrl, filmUrl,
        });
      });
    });
  });

  return screenings;
};
