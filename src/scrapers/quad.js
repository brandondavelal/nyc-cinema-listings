'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const { normalizeTime } = require('../utils/dates');

const BASE    = 'https://quadcinema.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

// "9.30pm" -> "9:30 PM" so normalizeTime can parse it
function fixTimeFormat(raw) {
  const m = raw.trim().match(/^(\d{1,2})\.(\d{2})\s*(am|pm)$/i);
  if (!m) return raw.trim();
  return `${m[1]}:${m[2]} ${m[3].toUpperCase()}`;
}

module.exports = async function scrapeQuad() {
  const { data } = await axios.get(`${BASE}/all/`, { headers: HEADERS, timeout: 15000 });
  const $ = cheerio.load(data);
  const screenings = [];
  const seen = new Set();

  // .now-single-day > .now-listings > .single-listing: h4>a (title), ul.showtimes-list>li>a (time, ticket)
  $('.now-single-day .single-listing').each((_, listingEl) => {
    const listing = $(listingEl);
    const titleLink = listing.find('h4 a').first();
    const title     = titleLink.text().trim();
    if (!title) return;
    const filmUrl = titleLink.attr('href') || null;

    listing.find('ul.showtimes-list li a[href*="fandango.com"]').each((_, aEl) => {
      const link    = $(aEl);
      const href    = link.attr('href') || '';
      const dateMatch = href.match(/date=(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) return;
      const date = dateMatch[1];

      const timeRaw = fixTimeFormat(link.text());
      if (!timeRaw) return;
      const { display: time, sort: sortTime } = normalizeTime(timeRaw);
      if (!sortTime) return;

      const key = `${title}|${date}|${time}`;
      if (seen.has(key)) return;
      seen.add(key);

      screenings.push({
        theater: 'Quad Cinema', theaterKey: 'quad',
        title, date, time, sortTime,
        ticketUrl: href, filmUrl,
      });
    });
  });

  return screenings;
};
