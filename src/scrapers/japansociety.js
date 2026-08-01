'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const { toISODate, normalizeTime } = require('../utils/dates');

const BASE       = 'https://japansociety.org';
const FILM_PAGE  = `${BASE}/film/`;
const FILM_TERM_ID = 9127;
const HEADERS    = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

// "7.8 WED, 6:00 pm" -> ISO date, rolling into next year if month/day already passed
function parseCardDate(raw) {
  const m = raw.trim().match(/^(\d{1,2})\.(\d{1,2})\s+[A-Za-z]+,/);
  if (!m) return null;
  const month = parseInt(m[1], 10) - 1;
  const day   = parseInt(m[2], 10);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let date = new Date(today.getFullYear(), month, day);
  if (date < today) date = new Date(today.getFullYear() + 1, month, day);
  return toISODate(date);
}

function parseCardTime(raw) {
  const m = raw.trim().match(/,\s*(\d{1,2}:\d{2}\s*[ap]m)/i);
  return m ? m[1] : null;
}

module.exports = async function scrapeJapanSociety() {
  const { data: pageHtml } = await axios.get(FILM_PAGE, { headers: HEADERS, timeout: 20000 });
  const $page = cheerio.load(pageHtml);

  const block = $page('[data-ajax-url][data-nonce]').first();
  const ajaxUrl = block.attr('data-ajax-url');
  const nonce   = block.attr('data-nonce');
  const limit   = block.attr('data-events-amount') || '50';
  if (!ajaxUrl || !nonce) return [];

  const body = new URLSearchParams();
  body.append('action', 'upcoming_events_v2_load_events');
  body.append('nonce', nonce);
  body.append('event_list_type', 'Upcoming');
  body.append('limit', limit);
  body.append('term_ids[]', String(FILM_TERM_ID));

  const { data: result } = await axios.post(ajaxUrl, body.toString(), {
    headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    timeout: 20000,
  });
  if (!result || !result.success || !result.data) return [];

  const $ = cheerio.load(result.data.desktop_html || '');
  const screenings = [];
  const seen = new Set();

  $('.fr-1-card').each((_, cardEl) => {
    const card = $(cardEl);
    const title = card.find('.fr-1-card__title a').first().text().trim();
    if (!title) return;

    const timeRaw = card.find('.fr-1-card__time').first().text().trim();
    const date = parseCardDate(timeRaw);
    const timeText = parseCardTime(timeRaw);
    if (!date || !timeText) return;

    const { display: time, sort: sortTime } = normalizeTime(timeText);
    const key = `${title}|${date}|${time}`;
    if (seen.has(key)) return;
    seen.add(key);

    const ticketUrl = card.find('.fr-1-card__permalink').first().attr('href') || null;
    const image = card.find('.fr-1-card__img').first().attr('src') || null;

    screenings.push({
      theater: 'Japan Society', theaterKey: 'japansociety',
      title, date, time, sortTime,
      ticketUrl, filmUrl: ticketUrl, image,
    });
  });

  return screenings;
};
