'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const { toISODate, normalizeTime } = require('../utils/dates');

const BASE       = 'https://ticketing.useast.veezi.com';
const SITE_TOKEN = 'dxdq5wzbef6bz2sjqt83ytzn1c';
const HEADERS    = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

// "Sunday 7, June" -> ISO date, rolling into next year if the day/month has already passed
function parseDateHeader(raw) {
  const m = raw.trim().match(/^[A-Za-z]+\s+(\d{1,2}),\s*([A-Za-z]+)/);
  if (!m) return null;
  const day   = parseInt(m[1], 10);
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let date = new Date(today.getFullYear(), month, day);
  if (date < today) date = new Date(today.getFullYear() + 1, month, day);
  return toISODate(date);
}

module.exports = async function scrapeSyndicated() {
  const { data } = await axios.get(`${BASE}/sessions/?siteToken=${SITE_TOKEN}`, { headers: HEADERS, timeout: 15000 });
  const $ = cheerio.load(data);
  const screenings = [];
  const seen = new Set();

  $('.film').each((_, filmEl) => {
    const film  = $(filmEl);
    const title = film.find('h3.title').first().text().trim();
    if (!title) return;
    const posterSrc = film.find('img.poster').first().attr('src');
    const image = posterSrc ? BASE + posterSrc : null;

    film.find('.date-container').each((_, dcEl) => {
      const dc   = $(dcEl);
      const date = parseDateHeader(dc.find('h4.date').first().text());
      if (!date) return;

      dc.find('ul.session-times li a').each((_, aEl) => {
        const link      = $(aEl);
        const timeText  = link.find('time').first().text().trim();
        const ticketUrl = link.attr('href') || null;
        if (!timeText) return;

        const { display: time, sort: sortTime } = normalizeTime(timeText);
        const key = `${title}|${date}|${time}`;
        if (seen.has(key)) return;
        seen.add(key);

        screenings.push({
          theater: 'Syndicated', theaterKey: 'syndicated',
          title, date, time, sortTime,
          ticketUrl, filmUrl: ticketUrl, image,
        });
      });
    });
  });

  return screenings;
};
