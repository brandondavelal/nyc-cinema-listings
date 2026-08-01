'use strict';

const axios = require('axios');
const { toISODate } = require('../utils/dates');

const BASE_URL   = 'https://riotheatre.ca';
const API_URL    = `${BASE_URL}/wp-json/barker/v1/listings`;
const THEATER    = 'Rio Theatre';
const THEATER_KEY = 'rio';

module.exports = async function scrapeRio() {
  const start = new Date().toISOString();
  const end   = new Date(Date.now() + 22 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await axios.get(API_URL, {
    params: { _embed: true, start_date: start, end_date: end, per_page: 500 },
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    timeout: 15000,
  });

  return data
    .map(item => {
      const event = item.event || {};
      const title = event.title;
      if (!title) return null;

      // Parse date/time directly from ISO string to avoid TZ conversion
      // e.g. "2026-06-02T19:30:00-07:00"
      const raw = item.start_time || '';
      const [datePart, timePart] = raw.split('T');
      if (!datePart) return null;

      const timeOnly = (timePart || '').replace(/[+-]\d{2}:\d{2}$/, '');
      const [h, m] = timeOnly.split(':').map(Number);
      const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const period = h >= 12 ? 'PM' : 'AM';

      return {
        theater: THEATER,
        theaterKey: THEATER_KEY,
        title,
        date: datePart,
        time: `${displayH}:${String(m).padStart(2, '0')} ${period}`,
        sortTime: h * 60 + m,
        ticketUrl: item.tickets_link || null,
        filmUrl: event.link || null,
      };
    })
    .filter(Boolean);
};
