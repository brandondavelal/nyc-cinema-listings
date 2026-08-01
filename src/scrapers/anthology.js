'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const { toISODate, normalizeTime } = require('../utils/dates');
const { toTitleCase } = require('../utils/text');

const BASE       = 'https://ticketing.us.veezi.com';
const SITE_TOKEN = 'bsrxtagjxmgh2qy0b6p646xdcr';
const SITE_BASE  = 'https://anthologyfilmarchives.org';
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

// The Veezi booking widget only carries times/tickets — Anthology's own site calendar
// carries the director/year/runtime/synopsis for each title, keyed off the bare
// ALL-CAPS film name shown in both places.
//
// Each listing renders as:
//   <span class="film-title">TITLE</span><br/>
//   by DIRECTOR<br/>
//   [version note,] YEAR, RUNTIME min, FORMAT<br/>
//   ...<span class="share-toggle">...
//   <div class="film-notes"><img class="screening-image" src="..."/><p>SYNOPSIS</p></div>
function parseFilmShowing($, el) {
  const $el   = $(el);
  const title = $el.find('.film-title').first().text().trim();
  if (!title) return null;

  // Walk the DOM nodes between the title <span> and the "Share +" toggle, splitting
  // accumulated text on <br> tags — gives us the byline / year-runtime lines with
  // HTML entities already decoded by cheerio (e.g. "&amp;" -> "&").
  const lines = [];
  let collecting = false;
  let current = '';
  $el.find('.showing-details').first().contents().each((i, node) => {
    if (node.type === 'tag' && node.name === 'span' && $(node).hasClass('film-title')) {
      collecting = true;
      return;
    }
    if (!collecting) return;
    if (node.type === 'tag' && node.name === 'span' && $(node).hasClass('share-toggle')) {
      if (current.trim()) lines.push(current.trim());
      return false;
    }
    if (node.type === 'tag' && node.name === 'br') {
      if (current.trim()) lines.push(current.trim());
      current = '';
    } else if (node.type === 'text') {
      current += $(node).text();
    }
  });

  let director = null, year = null, runtime = null;
  for (const line of lines) {
    const byM = line.match(/^by\s+(.+)$/i);
    if (byM && !director) { director = byM[1].trim(); continue; }
    const ymM = line.match(/(\d{4}),\s*(\d{2,3})\s*min/);
    if (ymM && !year) { year = ymM[1]; runtime = `${ymM[2]} min`; }
  }

  const description = $el.find('.film-notes p').first().text().replace(/\s+/g, ' ').trim() || null;
  const imgSrc      = $el.find('.film-notes img.screening-image').first().attr('src');
  const image       = imgSrc ? (imgSrc.startsWith('http') ? imgSrc : SITE_BASE + imgSrc) : null;

  return { title, director, year, runtime, description, image };
}

async function fetchFilmInfoMap() {
  const map = {};
  const today = new Date();
  const months = [
    { month: today.getMonth() + 1, year: today.getFullYear() },
    { month: today.getMonth() + 2 > 12 ? 1 : today.getMonth() + 2, year: today.getMonth() + 2 > 12 ? today.getFullYear() + 1 : today.getFullYear() },
  ];

  await Promise.all(months.map(async ({ month, year }) => {
    try {
      const { data } = await axios.get(
        `${SITE_BASE}/film_screenings/calendar?view=list&month=${month}&year=${year}`,
        { headers: HEADERS, timeout: 20000 }
      );
      const $ = cheerio.load(data);
      $('.film-showing').each((_, el) => {
        const info = parseFilmShowing($, el);
        if (!info) return;
        const key = info.title.toLowerCase().trim();
        if (!map[key]) map[key] = info;
      });
    } catch { /* skip failed months */ }
  }));

  return map;
}

module.exports = async function scrapeAnthology() {
  const [{ data }, infoMap] = await Promise.all([
    axios.get(`${BASE}/sessions/?siteToken=${SITE_TOKEN}`, { headers: HEADERS, timeout: 15000 }),
    fetchFilmInfoMap(),
  ]);
  const $ = cheerio.load(data);
  const screenings = [];
  const seen = new Set();

  $('.film').each((_, filmEl) => {
    const film     = $(filmEl);
    const rawTitle = film.find('h3.title').first().text().trim();
    if (!rawTitle) return;
    const title = toTitleCase(rawTitle);
    const info  = infoMap[rawTitle.toLowerCase().trim()] || {};

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
          theater: 'Anthology Film Archives', theaterKey: 'anthology',
          title, date, time, sortTime,
          ticketUrl, filmUrl: ticketUrl,
          image:       info.image       || null,
          description: info.description || null,
          director:    info.director    || null,
          year:        info.year        || null,
          runtime:     info.runtime     || null,
        });
      });
    });
  });

  return screenings;
};
