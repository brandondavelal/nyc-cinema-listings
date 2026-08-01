'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const { normalizeTime } = require('../utils/dates');

const BASE    = 'https://www.roxycinemanewyork.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

module.exports = async function scrapeRoxy() {
  const { data } = await axios.get(`${BASE}/now-showing`, { headers: HEADERS, timeout: 15000 });
  const $ = cheerio.load(data);
  const screenings = [];
  const seen = new Set();

  // Each day is a group div carrying its ISO date directly: data-date="2026-06-06"
  $('.grid__listings--group[data-date]').each((_, groupEl) => {
    const group = $(groupEl);
    const date  = group.attr('data-date');
    if (!date) return;

    group.find('.detailed-screening__card').each((_, cardEl) => {
      const card = $(cardEl);
      const titleRaw = card.find('h3.detailed-screening__title').first().text().trim();
      const title = titleRaw.replace(/\s*[-–—|]\s*(35MM|Q&A|I Paused My Game.*|Introduced by.*)/i, '').trim();
      if (!title) return;

      const timeRaw = card.find('.detailed-screening__actions--time').first().text().trim();
      if (!timeRaw) return;
      const { display: time, sort: sortTime } = normalizeTime(timeRaw);

      const ticketEl = card.find('a[href*="veezi.com"], a[href*="fandango.com"]').first();
      const ticketUrl = ticketEl.length ? ticketEl.attr('href') : null;

      const filmEl = card.find('a[href*="/screenings/"]').first();
      const filmUrl = filmEl.length ? filmEl.attr('href') : null;

      const key = `${title}|${date}|${time}`;
      if (seen.has(key)) return;
      seen.add(key);

      screenings.push({ theater: 'Roxy Cinema', theaterKey: 'roxy', title, date, time, sortTime, ticketUrl, filmUrl });
    });
  });

  return screenings;
};
