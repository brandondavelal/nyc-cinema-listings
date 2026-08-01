'use strict';

let _browser = null;

async function getBrowser() {
  if (_browser) return _browser;

  const puppeteer = require('puppeteer');
  _browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  _browser.on('disconnected', () => { _browser = null; });
  return _browser;
}

async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

module.exports = { getBrowser, closeBrowser };
