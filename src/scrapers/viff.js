'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { parseShortDate, normalizeTime } = require('../utils/dates');

const BASE_URL = 'https://viff.org';
const LISTING_URL = `${BASE_URL}/whats-on/`;
const THEATER = 'VIFF';
const THEATER_KEY = 'viff';
const MAX_PAGES = 8;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

module.exports = async function scrapeViff() {
  // Fetch all pages in parallel
  const urls = [
    LISTING_URL,
    ...Array.from({ length: MAX_PAGES - 1 }, (_, i) => `${BASE_URL}/whats-on/page/${i + 2}/`),
  ];

  const results = await Promise.allSettled(
    urls.map(url => axios.get(url, { headers: { 'User-Agent': UA }, timeout: 15000 }))
  );

  const screenings = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const $ = cheerio.load(result.value.data);

    $('.c-event-card').each((_, cardEl) => {
      const c = $(cardEl);

      const titleLink = c.find('.c-event-card__title a');
      const title = titleLink.text().trim();
      const filmUrl = titleLink.attr('href') || null;
      if (!title) return;

      // Poster: extract 600w URL from data-srcset
      const imgEl = c.find('.c-event-card__image img');
      const srcset = imgEl.attr('data-srcset') || '';
      let image = null;
      if (srcset) {
        const m = srcset.match(/(\S+)\s+600w/);
        image = m ? m[1] : srcset.split(',')[0]?.split(/\s+/)[0] || null;
      }

      // Director (strips "Dir. " prefix)
      const dirRaw = c.find('.c-event-card__subtitle').text().trim();
      const director = dirRaw.replace(/^Dir\.\s*/i, '').trim() || null;

      // Description
      const description = c.find('.c-event-card__excerpt').text().trim() || null;

      // Runtime from duration badge (e.g. "90 min")
      const durText = c.find('.c-event-card__duration').text().replace(/\s+/g, ' ').trim();
      const durMatch = durText.match(/(\d+)\s*min/);
      const runtime = durMatch ? `${durMatch[1]} min` : null;

      // Each screening instance
      c.find('.c-event-instance').each((_, instEl) => {
        const inst = $(instEl);

        const dateText = inst.find('.c-event-instance__date span').text().trim();
        const timeText = inst.find('.c-event-instance__time').text().trim();
        const ticketHref = inst.find('.c-event-instance__btn[href], .c-btn[href]').first().attr('href') || null;

        const date = parseShortDate(dateText);
        if (!date) return;

        const { display: time, sort: sortTime } = normalizeTime(timeText);

        const ticketUrl = ticketHref
          ? (ticketHref.startsWith('http') ? ticketHref : `${BASE_URL}${ticketHref}`)
          : null;

        screenings.push({
          theater: THEATER,
          theaterKey: THEATER_KEY,
          title,
          date,
          time,
          sortTime,
          ticketUrl,
          filmUrl,
          image,
          description,
          director,
          runtime,
          year: null,
          country: null,
          language: null,
        });
      });
    });
  }

  return screenings;
};
