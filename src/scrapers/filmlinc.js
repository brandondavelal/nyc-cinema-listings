'use strict';

const axios = require('axios');
const { normalizeTime, getNextSevenDays } = require('../utils/dates');

// Film at Lincoln Center. www.filmlinc.org sits behind a Cloudflare bot
// challenge, but the JSON feed its own calendar reads from does not, so we use
// that. It carries titles, showtimes and ticket links only — no artwork or
// film-page URLs, and film pages are challenge-gated, so there's no enrichment.
const API     = 'https://api.filmlinc.org/showtimes';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  Accept: 'application/json',
  Origin: 'https://www.filmlinc.org',
  Referer: 'https://www.filmlinc.org/',
};

module.exports = async function scrapeFilmLinc() {
  const { data } = await axios.get(API, { headers: HEADERS, timeout: 20000 });
  if (!data || !Array.isArray(data.films)) throw new Error('Unexpected Film at Lincoln Center response');

  const days = new Set(getNextSevenDays());
  const screenings = [];
  const seen = new Set();

  data.films.forEach(film => {
    const title = (film.title || '').trim();
    if (!title) return;
    (film.showtimes || []).forEach(st => {
      if (!days.has(st.date) || !st.time) return;
      const { display: time, sort: sortTime } = normalizeTime(st.time);
      const key = `${title}|${st.date}|${time}|${st.venue}`;
      if (seen.has(key)) return;
      seen.add(key);

      screenings.push({
        theater: 'Film at Lincoln Center', theaterKey: 'filmlinc',
        title, date: st.date, time, sortTime,
        ticketUrl: st.ticketsUrl || null, filmUrl: null, image: null,
      });
    });
  });

  return screenings;
};
