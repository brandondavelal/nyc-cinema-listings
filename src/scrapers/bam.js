'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const { normalizeTime } = require('../utils/dates');

const BASE    = 'https://www.bam.org';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };
const CONCURRENCY = 8;

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

module.exports = async function scrapeBAM() {
  const { data: listHtml } = await axios.get(`${BASE}/film`, { headers: HEADERS, timeout: 20000 });
  const $list = cheerio.load(listHtml);

  const slugs = new Set();
  $list('a[href^="/film/"]').each((_, el) => {
    const href = $list(el).attr('href');
    if (/^\/film\/\d{4}\/[a-z0-9-]+$/.test(href)) slugs.add(href);
  });

  const screenings = [];
  const seen = new Set();

  await mapLimit([...slugs], CONCURRENCY, async (slug) => {
    let html;
    try {
      ({ data: html } = await axios.get(`${BASE}${slug}`, { headers: HEADERS, timeout: 20000 }));
    } catch (e) {
      return;
    }

    const m = html.match(/<script type="application\/ld\+json">\s*(\{[\s\S]*?\})\s*<\/script>/);
    if (!m) return;

    let data;
    try { data = JSON.parse(m[1]); } catch (e) { return; }

    const events = (data.graph || []).filter(n => n['@type'] === 'Event' && n.startDate);
    events.forEach(ev => {
      // Parse "2026-06-07T13:50:00-04:00" directly — avoid timezone conversion via Date getters
      const m2 = String(ev.startDate).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (!m2) return;

      const date = `${m2[1]}-${m2[2]}-${m2[3]}`;
      const { display: time, sort: sortTime } = normalizeTime(`${m2[4]}:${m2[5]}`);

      const title = ev.name.replace(/\s*-\s*[A-Z][a-z]{2},\s.*$/, '').trim();
      const key = `${title}|${date}|${time}`;
      if (seen.has(key)) return;
      seen.add(key);

      screenings.push({
        theater: 'BAM', theaterKey: 'bam',
        title, date, time, sortTime,
        ticketUrl: ev.offers?.url || `${BASE}${slug}`,
        filmUrl: `${BASE}${slug}`,
        image: ev.image || null,
      });
    });
  });

  return screenings;
};
