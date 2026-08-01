'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const scrapeMetrograph                                   = require('./metrograph');
const { scrapeNitehawkWilliamsburg } = require('./nitehawk');
const scrapeIFC                                          = require('./ifc');
const scrapeRoxy                                         = require('./roxy');
const scrapeLowCinema                                    = require('./lowcinema');
const scrapeQuad                                         = require('./quad');
const scrapeSyndicated                                   = require('./syndicated');
const scrapeParis                                        = require('./paris');
const scrapeFilmForum                                    = require('./filmforum');
const scrapeAnthology                                    = require('./anthology');
const scrapeJapanSociety                                 = require('./japansociety');
const scrapeMoMI                                         = require('./momi');
const scrapeBAM                                          = require('./bam');
const scrapeSpectacle                                    = require('./spectacle');
const scrapeLAlliance                                    = require('./lalliance');
const { scrapeAngelikaNYC, scrapeVillageEast, scrapeCinema123 } = require('./angelika');

const { enrichScreenings } = require('../film-details');
const { getNextSevenDays } = require('../utils/dates');

const SCRAPERS = [
  { fn: scrapeMetrograph,             name: 'Metrograph' },
  { fn: scrapeNitehawkWilliamsburg,   name: 'Nitehawk Williamsburg' },
  { fn: scrapeIFC,                    name: 'IFC Center' },
  { fn: scrapeRoxy,                   name: 'Roxy Cinema' },
  { fn: scrapeLowCinema,              name: 'Low Cinema' },
  { fn: scrapeQuad,                   name: 'Quad Cinema' },
  { fn: scrapeSyndicated,             name: 'Syndicated' },
  { fn: scrapeParis,                  name: 'Paris Theater' },
  { fn: scrapeFilmForum,              name: 'Film Forum' },
  { fn: scrapeAnthology,              name: 'Anthology Film Archives' },
  { fn: scrapeJapanSociety,           name: 'Japan Society' },
  { fn: scrapeMoMI,                   name: 'Museum of the Moving Image' },
  { fn: scrapeBAM,                    name: 'BAM' },
  { fn: scrapeSpectacle,              name: 'Spectacle Theater' },
  { fn: scrapeLAlliance,              name: "L'Alliance New York" },
  { fn: scrapeAngelikaNYC,            name: 'Angelika Film Center' },
  { fn: scrapeVillageEast,            name: 'Village East by Angelika' },
  { fn: scrapeCinema123,              name: 'Cinema 123 by Angelika' },
];

const CACHE_TTL  = 30 * 60 * 1000;
const PREV_FILE  = path.join(os.tmpdir(), 'ny-cinema-prev.json');
const CACHE_FILE = path.join(os.tmpdir(), 'ny-cinema-cache.json');

const caches     = { standard: null };
const cacheTimes = { standard: 0 };
let inFlight     = null; // dedupes concurrent scrapes; lets callers await a scrape already running in the background

function normTitle(title) {
  return String(title)
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\([^)]*$/, '')
    .replace(/\s*[…\.]{2,}$/, '')
    .trim()
    .toLowerCase()
    .replace(/\s*&\s*/g, ' and ');
}

let prevData = {};

function buildPrevData(screenings) {
  const map = {};
  screenings.forEach(s => {
    const k = normTitle(s.title) + '|' + s.theaterKey;
    if (!map[k]) map[k] = [];
    if (!map[k].includes(s.time)) map[k].push(s.time);
  });
  return map;
}

try {
  const saved = JSON.parse(fs.readFileSync(PREV_FILE, 'utf8'));
  if (saved.data) prevData = saved.data;
} catch (e) {}

function savePrevData(data) {
  try { fs.writeFileSync(PREV_FILE, JSON.stringify({ data })); } catch (e) {}
}

// Persisted full scrape result, so a fresh server boot can show last session's
// listings immediately instead of blocking on a brand-new scrape.
try {
  const savedCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  if (savedCache && Array.isArray(savedCache.screenings)) {
    caches.standard = savedCache;
    cacheTimes.standard = savedCache.lastUpdated ? Date.parse(savedCache.lastUpdated) : 0;
  }
} catch (e) {}

function saveCache(data) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(data)); } catch (e) {}
}

async function scrapeAndCache() {
  const scrapers = SCRAPERS;
  console.log('\nScraping theaters...');

  const allDays = getNextSevenDays();

  const results = await Promise.allSettled(
    scrapers.map(({ fn, name }) =>
      fn()
        .then(list => { console.log(`  ✓ ${name}: ${list.length} screenings`); return list; })
        .catch(err  => { console.error(`  ✗ ${name}: ${err.message}`); throw err; })
    )
  );

  const raw    = [];
  const errors = {};

  results.forEach((r, i) => {
    const { name } = scrapers[i];
    if (r.status === 'fulfilled') raw.push(...r.value.filter(s => /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(s.time)));
    else errors[name] = r.reason?.message || 'Unknown error';
  });

  const filtered = raw.filter(s => !/private\s+event/i.test(s.title));

  let enriched;
  try {
    enriched = await enrichScreenings(filtered);
  } catch (err) {
    console.error('  [enrich] failed:', err.message);
    enriched = filtered;
  }

  const screenings = enriched.sort((a, b) =>
    a.date.localeCompare(b.date) || a.sortTime - b.sortTime
  );

  if (Object.keys(prevData).length > 0) {
    screenings.forEach(s => {
      const k = normTitle(s.title) + '|' + s.theaterKey;
      if (!prevData[k] || !prevData[k].includes(s.time)) s.isNew = true;
    });
  }

  const data = { screenings, days: allDays, errors, lastUpdated: new Date().toISOString() };
  caches.standard     = data;
  cacheTimes.standard = Date.now();
  saveCache(data);

  prevData = buildPrevData(screenings);
  savePrevData(prevData);

  console.log(`\nTotal: ${screenings.length} screenings over next ${allDays.length} days\n`);

  return data;
}

function startScrape() {
  if (!inFlight) inFlight = scrapeAndCache().finally(() => { inFlight = null; });
  return inFlight;
}

// Stale-while-revalidate: if we have any cached data (even stale/persisted-from-disk),
// serve it immediately and refresh in the background. Only block on a scrape when
// there's truly nothing to show yet, or when the caller explicitly forces a refresh.
async function getAllScreenings({ forceRefresh = false } = {}) {
  const isFresh = caches.standard && (Date.now() - cacheTimes.standard < CACHE_TTL);
  if (isFresh && !forceRefresh) return caches.standard;

  if (forceRefresh || !caches.standard) return startScrape();

  startScrape(); // kick off in the background; ignore the promise
  return caches.standard;
}

async function refreshScreenings() {
  if (caches.standard?.screenings) {
    prevData = buildPrevData(caches.standard.screenings);
  }
  return getAllScreenings({ forceRefresh: true });
}

module.exports = { getAllScreenings, refreshScreenings };
