'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const { getBrowser } = require('../utils/browser');
const { getNextSevenDays, normalizeTime } = require('../utils/dates');
const { toTitleCase } = require('../utils/text');

const API_BASE = 'https://production-api.readingcinemas.com';
const HEADERS  = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
};

// The Angelika sites are a React SPA whose API sits behind a short-lived Cognito
// bearer token issued client-side on page load. Rather than reverse-engineering
// that auth flow, we load the page once in a real browser, capture the token it
// gets issued, and reuse it (with axios) for every date/location we need — the
// token is valid for ~60min, comfortably longer than a full scrape.
let cachedToken     = null;
let tokenExpiresAt  = 0;
let tokenPromise    = null;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  if (!tokenPromise) tokenPromise = fetchFreshToken().finally(() => { tokenPromise = null; });
  return tokenPromise;
}

async function fetchFreshToken() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    let token = null;
    page.on('request', req => {
      if (!token && req.method() === 'GET' && req.url().includes(`${API_BASE}/films`)) {
        token = req.headers()['authorization'] || null;
      }
    });
    await page.goto('https://angelikafilmcenter.com/nyc/now-playing', { waitUntil: 'domcontentloaded', timeout: 30000 });
    for (let i = 0; i < 30 && !token; i++) await new Promise(r => setTimeout(r, 500));
    if (!token) throw new Error('Could not capture Angelika API token');
    cachedToken = token;
    tokenExpiresAt = Date.now() + 45 * 60 * 1000; // refresh a bit before the ~60min token expiry
    return token;
  } finally {
    await page.close();
  }
}

// "2026-07-06T11:55:00-04" -> normalizeTime with an explicit AM/PM marker, since
// normalizeTime's no-marker heuristic assumes PM (wrong for real 24h data like this).
function parseShowtime(dateTimeStr) {
  const m = (dateTimeStr || '').match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  const hour24 = parseInt(m[1], 10);
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const displayHour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return normalizeTime(`${displayHour}:${m[2]} ${period}`);
}

function stripHtml(html) {
  const text = cheerio.load(html || '').text().trim().replace(/\s+/g, ' ');
  return text || null;
}

async function fetchDate(cinemaId, urlSlug, theater, theaterKey, token, date) {
  let movies;
  try {
    const res = await axios.get(`${API_BASE}/films`, {
      params: { countryId: 6, cinemaId, status: 'getShows', flag: 'initial', selectedDate: date },
      headers: { ...HEADERS, Authorization: token },
      timeout: 15000,
    });
    movies = res.data?.nowShowing?.data?.movies || [];
  } catch {
    return [];
  }

  const screenings = [];
  const seen = new Set();
  movies.forEach(movie => {
    const title = toTitleCase(movie.name || '');
    if (!title) return;

    const filmUrl = movie.movieSlug
      ? `https://angelikafilmcenter.com/${urlSlug}/movies/details/${movie.movieSlug}`
      : null;
    const image = movie.film_image_large_size || movie.poster_image || null;
    const director = movie.director || null;
    const runtime = movie.length ? `${movie.length} min` : null;
    const language = movie.language || null;
    const year = movie.release_date ? movie.release_date.slice(0, 4) : null;
    const description = stripHtml(movie.synopsis);

    (movie.showdates || []).forEach(showdate => {
      (showdate.showtypes || []).forEach(showtype => {
        (showtype.showtimes || []).forEach(st => {
          if (!st.enabled) return;
          const parsed = parseShowtime(st.date_time);
          if (!parsed) return;

          const key = `${title}|${showdate.date}|${parsed.display}`;
          if (seen.has(key)) return;
          seen.add(key);

          screenings.push({
            theater, theaterKey,
            title, date: showdate.date, time: parsed.display, sortTime: parsed.sort,
            ticketUrl: filmUrl, filmUrl, image,
            director, runtime, language, year, description,
          });
        });
      });
    });
  });

  return screenings;
}

async function scrapeLocation(cinemaId, urlSlug, theater, theaterKey) {
  const token = await getToken();
  const days = getNextSevenDays();
  const screenings = [];

  for (let i = 0; i < days.length; i += 8) {
    const chunk = days.slice(i, i + 8);
    const results = await Promise.all(
      chunk.map(date => fetchDate(cinemaId, urlSlug, theater, theaterKey, token, date))
    );
    results.forEach(list => screenings.push(...list));
  }

  return screenings;
}

module.exports.scrapeAngelikaNYC = () =>
  scrapeLocation('0000000005', 'nyc', 'Angelika Film Center', 'angelika');

module.exports.scrapeVillageEast = () =>
  scrapeLocation('0000000004', 'villageeast', 'Village East by Angelika', 'villageeast');

module.exports.scrapeCinema123 = () =>
  scrapeLocation('21', 'cinemas123', 'Cinema 123 by Angelika', 'cinema123');
