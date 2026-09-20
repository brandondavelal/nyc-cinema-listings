'use strict';

const fs = require('fs');
const path = require('path');
const { getAllScreenings, SCRAPERS } = require('./scrapers');
const { closeBrowser } = require('./utils/browser');

const OUT_FILE = path.join(__dirname, '..', 'docs', 'data.json');
const ISSUE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

function readPrevious() {
  try { return JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')); } catch { return null; }
}

// A theater that errored, or came back empty when it had listings before, keeps
// its last successful pull (for dates still ahead of us) until a scrape works.
function applyLastGood(data, prev) {
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const prevScreenings = (prev && prev.screenings) || [];
  const lastSuccess = { ...((prev && prev.lastSuccess) || {}) };
  const issues = ((prev && prev.issues) || []).filter(i => nowMs - Date.parse(i.at) < ISSUE_WINDOW_MS);
  const days = new Set(data.days);
  const counts = {};
  data.screenings.forEach(s => { counts[s.theaterKey] = (counts[s.theaterKey] || 0) + 1; });

  const carried = [];
  SCRAPERS.forEach(({ name, key }) => {
    let problem = data.errors && data.errors[name];
    const previous = prevScreenings.filter(s => s.theaterKey === key && days.has(s.date));
    if (!problem && !counts[key] && previous.length) problem = 'Returned no listings';

    if (!problem) {
      lastSuccess[key] = now;
      return;
    }
    const kept = counts[key] ? [] : previous; // never mix stale rows into a partial-but-nonempty result
    carried.push(...kept);
    issues.push({ theater: name, key, message: String(problem), at: now, keptListings: kept.length });
  });

  data.screenings = data.screenings.concat(carried)
    .sort((a, b) => a.date.localeCompare(b.date) || a.sortTime - b.sortTime);
  data.lastSuccess = lastSuccess;
  data.issues = issues;
  return carried.length;
}

async function main() {
  try {
    const prev = readPrevious();
    const data = await getAllScreenings({ forceRefresh: true });

    if (!data || !Array.isArray(data.screenings) || data.screenings.length === 0) {
      console.error('[build-data] Scrape returned no screenings — not overwriting docs/data.json');
      process.exitCode = 1;
      return;
    }

    const carried = applyLastGood(data, prev);
    if (carried) console.log(`[build-data] Kept ${carried} listings from the last successful scrape for failed theaters`);

    fs.writeFileSync(OUT_FILE, JSON.stringify(data));
    console.log(`[build-data] Wrote ${data.screenings.length} screenings to ${OUT_FILE}`);
  } catch (err) {
    console.error('[build-data] Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await closeBrowser();
  }
}

if (require.main === module) main();
module.exports = { applyLastGood };
