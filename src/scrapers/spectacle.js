'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const { normalizeTime } = require('../utils/dates');
const { toTitleCase } = require('../utils/text');

const BASE    = 'https://www.spectacletheater.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

module.exports = async function scrapeSpectacle() {
  const { data } = await axios.get(`${BASE}/spex-rolling.html`, { headers: HEADERS, timeout: 20000 });
  const $ = cheerio.load(data);
  const screenings = [];
  const seen = new Set();

  // Header row: each <th> carries an HTML comment with the column's ISO date
  const dates = [];
  $('table.spexcal > tbody > tr').first().find('th').each((_, th) => {
    const html = $.html(th);
    const m = html.match(/<!--\s*(\d{4}-\d{2}-\d{2})\s*-->/);
    dates.push(m ? m[1] : null);
  });

  $('table.spexcal > tbody > tr').slice(1).each((_, trEl) => {
    $(trEl).find('td').each((col, tdEl) => {
      const date = dates[col];
      if (!date) return;

      const link = $(tdEl).find('a').first();
      if (!link.length) return;

      const href = link.attr('href');
      const filmUrl = href ? (href.startsWith('http') ? href : BASE + href) : null;

      const img = link.find('img').first();
      const rawTitle = (img.attr('title') || img.attr('alt') || '').trim();
      if (!rawTitle) return;
      const title = toTitleCase(rawTitle);

      let timeText = link.clone().children().remove().end().text().trim();
      if (/^midnight$/i.test(timeText)) timeText = '12:00 am';

      const { display: time, sort: sortTime } = normalizeTime(timeText);
      const key = `${title}|${date}|${time}`;
      if (seen.has(key)) return;
      seen.add(key);

      // Source serves these over plain http (redirects to https) — WKWebView's
      // App Transport Security blocks the insecure load, so upgrade up front.
      const rawImage = img.attr('src') || null;
      const image = rawImage ? rawImage.replace(/^http:/, 'https:') : null;

      screenings.push({
        theater: 'Spectacle Theater', theaterKey: 'spectacle',
        title, date, time, sortTime,
        ticketUrl: filmUrl, filmUrl, image,
      });
    });
  });

  return screenings;
};
