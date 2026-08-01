'use strict';

const fs = require('fs');
const path = require('path');
const { getAllScreenings } = require('./scrapers');
const { closeBrowser } = require('./utils/browser');

const OUT_FILE = path.join(__dirname, '..', 'docs', 'data.json');

(async () => {
  try {
    const data = await getAllScreenings({ forceRefresh: true });

    if (!data || !Array.isArray(data.screenings) || data.screenings.length === 0) {
      console.error('[build-data] Scrape returned no screenings — not overwriting docs/data.json');
      process.exitCode = 1;
      return;
    }

    fs.writeFileSync(OUT_FILE, JSON.stringify(data));
    console.log(`[build-data] Wrote ${data.screenings.length} screenings to ${OUT_FILE}`);
  } catch (err) {
    console.error('[build-data] Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await closeBrowser();
  }
})();
