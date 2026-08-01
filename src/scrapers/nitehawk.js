'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const { getNextSevenDays, normalizeTime } = require('../utils/dates');

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

// Each date page at /{slug}/{date}/0/ contains <li> elements where:
//   - a[href*="/movies/"] gives the film title and detail URL
//   - a[href*="/purchase/"] gives ticket times (text = showtime)
//   - plain <li> text may also carry times (OC, sold out, etc.)
async function scrapeLocation(slug, theater, theaterKey) {
  const days = getNextSevenDays().slice(0, 14);
  const screenings = [];
  const seen = new Set();

  for (let i = 0; i < days.length; i += 3) {
    const chunk = days.slice(i, i + 3);
    await Promise.all(chunk.map(async date => {
      try {
        const url = `https://nitehawkcinema.com/${slug}/${date}/0/`;
        const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
        const $ = cheerio.load(data);

        // Each film lives in a <li> that contains a /movies/ link
        $('li').each((_, liEl) => {
          const li = $(liEl);
          const movieLink = li.find(`a[href*="/${slug}/movies/"]`).first();
          if (!movieLink.length) return;

          const title = movieLink.text().trim();
          const href  = movieLink.attr('href').split('?')[0];
          const filmUrl = href.startsWith('http') ? href : 'https://nitehawkcinema.com' + href;
          if (!title) return;

          // Poster art is set as a CSS background-image on .show-thumbnail
          const thumbStyle = li.find('.show-thumbnail').first().attr('style') || '';
          const imgM = thumbStyle.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
          const image = imgM ? imgM[1] : null;

          // Ticketed showtimes
          li.find('a[href*="/purchase/"]').each((_, aEl) => {
            const link      = $(aEl);
            const timeRaw   = link.text().replace(/OC|FAMILY|Sold\s*Out/gi, '').trim();
            const linkHref  = link.attr('href');
            const ticketUrl = linkHref.startsWith('http') ? linkHref : 'https://nitehawkcinema.com' + linkHref;
            if (!timeRaw) return;

            const { display: time, sort: sortTime } = normalizeTime(timeRaw);
            const key = `${title}|${date}|${time}`;
            if (seen.has(key)) return;
            seen.add(key);

            screenings.push({ theater, theaterKey, title, date, time, sortTime, ticketUrl, filmUrl, image });
          });

          // Non-ticketed showtimes (OC, sold out, etc.) — plain <li> inside showtimes list
          li.find('ul li').each((_, innerLi) => {
            const liLink = $(innerLi).find('a[href*="/purchase/"]');
            if (liLink.length) return; // already handled above
            const timeRaw = $(innerLi).text().replace(/OC|FAMILY|Sold\s*Out/gi, '').trim();
            if (!timeRaw) return;

            const { display: time, sort: sortTime } = normalizeTime(timeRaw);
            if (!time || sortTime === 0) return;

            const key = `${title}|${date}|${time}`;
            if (seen.has(key)) return;
            seen.add(key);

            screenings.push({ theater, theaterKey, title, date, time, sortTime, ticketUrl: null, filmUrl, image });
          });
        });
      } catch { /* skip failed dates */ }
    }));
  }

  return screenings;
}

module.exports.scrapeNitehawkWilliamsburg = () =>
  scrapeLocation('williamsburg', 'Nitehawk Williamsburg', 'nitehawk-w');
