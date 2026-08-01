'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE_FILE = path.join(os.homedir(), '.movies-van-film-cache.json');
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const CONCURRENCY = 6;

// Disk-backed cache
let store = {};
try { store = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { store = {}; }

function getCached(key) {
  const e = store[key];
  return e && Date.now() - e.t < CACHE_TTL ? e.d : null;
}

function setCached(key, data) {
  store[key] = { d: data, t: Date.now() };
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(store)); } catch { /* non-fatal */ }
}

// ─── Theater-specific parsers ─────────────────────────────────────────────────

function parseCinemathque($) {
  const image =
    $('img[src*="/assets/images/films/"]').first().attr('src') ||
    $('img[src*="thecinematheque.ca/assets"]').first().attr('src') ||
    null;

  // Blockquotes are the primary content on Cinematheque pages (critical reviews)
  const allQuotes = [];
  $('blockquote').each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, ' ');
    if (t.length > 30) allQuotes.push(t);
  });

  const description = allQuotes[0] || null;
  const quotes = allQuotes.slice(1);   // remaining reviews

  // Collect all short own-text nodes in document order (span/li only, excluding children's text)
  const elems = [];
  $('span, li').each((_, el) => {
    const own = $(el).clone().children().remove().end().text().trim();
    if (own.length > 0 && own.length < 80) elems.push(own);
  });

  // Year: first element whose own text is exactly a 4-digit year
  const yearIdx = elems.findIndex(t => /^(19[4-9]\d|20[0-2]\d)$/.test(t));
  const year = yearIdx >= 0 ? elems[yearIdx] : null;

  // Country: element immediately before year (Cinematheque order: country → year → director → runtime)
  let country = null;
  if (yearIdx > 0) {
    const prev = elems[yearIdx - 1];
    if (prev && !/\d/.test(prev) && prev.length < 50 &&
        !/^(The\s|Films|Learning|Library|Series|Venue|Donate|Gift|Visit|Equity|About|Calendar|Cart|Search|Nav|PG|G$|R$|NR|14A|18A|The Cinematheque)/.test(prev)) {
      country = prev;
    }
  }

  // Director: first name-like element in the 5 elements after the year
  const NON_NAME_STARTS = /^(PG|G$|R$|NR|NC|14A|18A|35|70|United|Great|New|North|South|East|West|Canada|France|Japan|Germany|Italy|Spain|Belgium|Denmark|Sweden|Norway|Finland|Ireland|Switzerland|Austria|British|American)/;
  let director = null;
  if (yearIdx >= 0) {
    for (let i = yearIdx + 1; i < Math.min(yearIdx + 6, elems.length); i++) {
      const t = elems[i];
      if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(t) && !NON_NAME_STARTS.test(t) && !/\d/.test(t)) {
        director = t;
        break;
      }
    }
  }

  // Runtime: first numeric-starting element after director (e.g. "140", "140 35mm")
  let runtime = null;
  const dirIdx = director ? elems.indexOf(director) : yearIdx;
  if (dirIdx >= 0) {
    for (let i = dirIdx + 1; i < Math.min(dirIdx + 4, elems.length); i++) {
      const m = elems[i].match(/^(\d+)/);
      if (m && parseInt(m[1]) > 30 && parseInt(m[1]) < 400) {
        runtime = `${m[1]} min`;
        break;
      }
    }
  }

  return { image, description, quotes, year, country, director, runtime };
}

function parsePark($) {
  const ogImage = $('meta[property="og:image"]').attr('content') || null;
  const ogW = parseInt($('meta[property="og:image:width"]').attr('content')  || '0');
  const ogH = parseInt($('meta[property="og:image:height"]').attr('content') || '0');

  // If og:image is portrait (poster art), prefer the first other content image
  // which is typically the landscape film still / banner
  const ogIsPortrait = ogW > 0 && ogH > 0 && ogW < ogH;
  const contentImages = $('img[src*="wp-content/uploads"]')
    .not('[src*="logo"]').not('[src*="icon"]').not('[src*="header"]');

  let image = null;
  if (ogIsPortrait) {
    // Find the first content image that is NOT the og:image (likely a landscape still)
    contentImages.each((_, el) => {
      if (image) return false;
      const src = $(el).attr('src') || '';
      if (src && src !== ogImage) image = src;
    });
    if (!image) image = ogImage; // fallback to portrait poster if nothing else found
  } else {
    image = ogImage || contentImages.first().attr('src') || null;
  }

  // All substantial paragraphs on the page
  const SKIP_PARK = /arrive early|final sale|no refund|membership.*Art House|purchase.*ticket|sold out|subject to change|doors\s+\d|newsletter|donated/i;
  const parkParas = [];
  $('p').each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, ' ');
    if (t.length > 60 && !SKIP_PARK.test(t)) parkParas.push(t);
  });

  // Main description: the longest paragraph (the full synopsis)
  const description = parkParas.reduce((best, t) => (!best || t.length > best.length ? t : best), null);

  // Review quotes: paragraphs with a parenthetical publication name at the end
  const PUBS = /\((RogerEbert|Observer|Daily Beast|IndieWire|Variety|Hollywood Reporter|Guardian|The Wrap|Cinema|Times|Screen|Sight|Film Threat)\b/i;
  const quotes = parkParas.filter(t => PUBS.test(t) && t !== description).slice(0, 5);

  const bodyText = $('body').text().replace(/\s+/g, ' ');

  // Park: find the element labeled "Director" and get the previous sibling (which holds the name)
  let director = null;
  $('span, li, td, p').each((_, el) => {
    const text = $(el).text().trim();
    if (text === 'Director') {
      const prev = $(el).prev().text().trim();
      if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(prev)) {
        director = prev;
        return false;
      }
      // Try parent sibling
      const parentPrev = $(el).parent().prev().text().trim();
      if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(parentPrev)) {
        director = parentPrev;
        return false;
      }
    }
  });
  // Fallback: exactly 2 words immediately before the word "Director"
  if (!director) {
    const m = bodyText.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\s+Director\b/);
    if (m) director = m[1].trim();
  }

  // Year: any 4-digit year in the page
  const yearMatch = bodyText.match(/\b(19[4-9]\d|20[0-2]\d)\b/);
  const year = yearMatch ? yearMatch[1] : null;

  // Park: value comes BEFORE its label in body text
  // "Canada, Hungary, United States of America Country Of Origin"
  const countryM = bodyText.match(/\bRated\s+([A-Za-z, ]+?)\s+Country\s+Of\s+Origin\b/);
  const country  = countryM ? countryM[1].trim() : null;

  // "English, Magyar Languages"
  const langM   = bodyText.match(/\bDirector\s+([A-Z][a-z]+(?:,\s*[A-Z][a-z]+)*)\s+Languages?\b/);
  const language = langM ? langM[1].trim() : null;

  // "91 minutes Runtime"
  const rtM    = bodyText.match(/\b(\d+)\s+minutes?\s+Runtime\b/);
  const runtime = rtM ? `${rtM[1]} min` : null;

  return { image, description, quotes, year, director, country, language, runtime };
}

function parseViffFilm($) {
  const image =
    $('img[src*="images.viff.org"]').first().attr('src') ||
    $('meta[property="og:image"]').attr('content') ||
    null;

  // Main description: first long paragraph NOT from the "related films" section
  let description = null;
  $('p').not('.c-event-card__excerpt').each((_, el) => {
    if (description) return false;
    const t = $(el).text().trim().replace(/\s+/g, ' ');
    if (t.length > 100 && !/xʷməθkʷəy̓əm|Musqueam|Charity Registration|VIFF thanks/i.test(t)) {
      description = t;
    }
  });

  // Review quote from blockquotes
  const quotes = [];
  $('blockquote').each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, ' ');
    if (t.length > 30) quotes.push(t);
  });

  const bodyText = $('body').text().replace(/\s+/g, ' ');

  // VIFF film pages: "Country of Origin Canada/NZ Year 2025 Language English 19+ 95 min"
  const body = $('body').text().replace(/\s+/g, ' ');

  const countryM  = body.match(/Country\s+of\s+Origin\s+([A-Za-z/,\s]+?)\s+Year\b/i);
  const country   = countryM ? countryM[1].trim() : null;

  const yearM     = body.match(/\bYear\s+(\d{4})\b/i);
  const year      = yearM ? yearM[1] : null;

  const langM     = body.match(/\bLanguage\s+([A-Za-z][A-Za-z, ]+?)\s+(?:\d+\+|\d+\s*min)/i);
  const language  = langM ? langM[1].trim() : null;

  const rtM       = body.match(/\b(\d{2,3})\s*min\b/);
  const runtime   = rtM ? `${rtM[1]} min` : null;

  const dirMatch  = body.match(/Director[:\s]+([A-Z][a-zéàâîïôùûæœ'-]+(?:\s+[A-Z][a-zéàâîïôùûæœ'-]+){1,3})/);
  const director  = dirMatch ? dirMatch[1].trim() : null;

  return { image, description, quotes, year, country, language, director, runtime };
}

// ─── NYC theater parsers ──────────────────────────────────────────────────────

function parseMetrograph($) {
  const image = $('img[src*="wp-content/uploads"]').not('[src*="logo"]').first().attr('src') || null;

  const description = $('p').toArray()
    .map(el => $(el).text().trim().replace(/\s+/g, ' '))
    .reduce((best, t) => (t.length > 100 && (!best || t.length > best.length) ? t : best), null);

  const body = $('body').text().replace(/\s+/g, ' ');
  // "Director: Louis Malle1985 / 89min / 16mm"
  const m = body.match(/Director:\s*([A-Z][a-zà-ÿ.''-]+(?:\s+[A-Z][a-zà-ÿ.''-]+){0,3})\s*(\d{4})\s*\/\s*(\d{2,3})\s*min\s*\/\s*(\w+)/i);
  const director = m ? m[1].trim() : null;
  const year     = m ? m[2] : null;
  const runtime  = m ? `${m[3]} min` : null;
  const format   = m ? m[4] : null;

  return { image, description, director, year, runtime, format };
}

function parseIFC($) {
  const image = $('meta[property="og:image"]').attr('content') || null;

  const description = $('p').toArray()
    .map(el => $(el).text().trim().replace(/\s+/g, ' '))
    .filter(t => t.length > 100 && !/^Country\b/.test(t) && !/^IFC Center does not generally provide advisories/.test(t))
    .reduce((best, t) => (!best || t.length > best.length ? t : best), null);

  // Film facts are rendered as <li><strong>Label</strong> Value</li>
  const facts = {};
  $('li').each((i, el) => {
    const $el = $(el);
    const label = $el.find('strong').first().text().trim().replace(/:$/, '');
    if (label) facts[label] = $el.clone().find('strong').remove().end().text().trim();
  });

  const rtM = facts['Running Time'] && facts['Running Time'].match(/(\d{2,3})/);

  return {
    image, description,
    country:  facts['Country']  || null,
    runtime:  rtM ? `${rtM[1]} min` : null,
    director: facts['Director'] || null,
  };
}

function parseRoxy($) {
  const image = $('meta[property="og:image"]').attr('content') || null;

  const description = $('p').toArray()
    .map(el => $(el).text().trim().replace(/\s+/g, ' '))
    .reduce((best, t) => (t.length > 100 && (!best || t.length > best.length) ? t : best), null);

  const body = $('body').text().replace(/\s+/g, ' ');
  // "Drama, History, Thriller | 2025 | 136MIN"
  const m = body.match(/([A-Za-z][A-Za-z, ]+?)\s*\|\s*(\d{4})\s*\|\s*(\d{2,3})\s*MIN/i);
  const dirM = body.match(/Director\s+([A-Z][a-zà-ÿ.''-]+(?:\s+[A-Z][a-zà-ÿ.''-]+){0,3})(?=Cast|Buy Tickets|$)/);

  return {
    image, description,
    country: m ? m[1].trim() : null,
    year:    m ? m[2] : null,
    runtime: m ? `${m[3]} min` : null,
    director: dirM ? dirM[1].trim() : null,
  };
}

function parseNitehawk($) {
  const image = $('meta[property="og:image"]').attr('content') ||
    $('img[src*="wp-content/uploads"]').not('[src*="logo"]').first().attr('src') || null;

  // Every page carries a generic <p class="nitehawk-calendar-description"> blurb
  // about the venue's schedule — long enough and period-terminated enough to win
  // the synopsis heuristic below, so it has to be excluded explicitly.
  const description = $('p').not('.nitehawk-calendar-description').toArray()
    .map(el => $(el).text().trim().replace(/\s+/g, ' '))
    .filter(t => /\.\s*$/.test(t))
    .reduce((best, t) => (t.length > 80 && (!best || t.length > best.length) ? t : best), null);

  const body = $('body').text().replace(/\s+/g, ' ');
  // "Director: Michael Tiddes Run Time: 95 min. Format: DCP Rating: R Release Year: 2026"
  const dirM = body.match(/Director:\s*([A-Z][a-zà-ÿ.''-]+(?:\s+[A-Z][a-zà-ÿ.''-]+){0,3})\s+Run\s+Time/);
  const rtM  = body.match(/Run\s+Time:\s*(\d{2,3})\s*min/i);
  const yrM  = body.match(/Release\s+Year:\s*(\d{4})/);

  return {
    image, description,
    director: dirM ? dirM[1].trim() : null,
    runtime:  rtM ? `${rtM[1]} min` : null,
    year:     yrM ? yrM[1] : null,
  };
}

function parseQuad($) {
  const image = $('meta[property="og:image"]').attr('content') || null;

  const description = $('p').toArray()
    .map(el => $(el).text().trim().replace(/\s+/g, ' '))
    .reduce((best, t) => (t.length > 100 && (!best || t.length > best.length) ? t : best), null);

  const body = $('body').text().replace(/\s+/g, ' ');
  // "Bound 1996, 108m, DCP, U.S."
  const m = body.match(/(\d{4}),\s*(\d{2,3})m,/);
  const dirM = body.match(/[Dd]irect(?:ed by|or)[:\s]+([A-Z][a-zà-ÿ.''-]+(?:\s+[A-Z][a-zà-ÿ.''-]+){0,3})/);

  return {
    image, description,
    year:    m ? m[1] : null,
    runtime: m ? `${m[2]} min` : null,
    director: dirM ? dirM[1].trim() : null,
  };
}

function parseAtomFilm($) {
  const body = $('body').text().replace(/\s+/g, ' ');
  const rtM = body.match(/Runtime:\s*(\d{1,2})hr\s*(\d{1,2})?m?/);
  const runtime = rtM ? `${parseInt(rtM[1], 10) * 60 + (rtM[2] ? parseInt(rtM[2], 10) : 0)} min` : null;
  const synM = body.match(/Synopsis\s+(.{40,600}?)\s+(?:Letterboxd|Atom Users|Frequently Asked)/);
  const description = synM ? synM[1].trim() : null;

  return { runtime, description };
}

// "MARIANNA BRENNAND" -> "Marianna Brennand"
function nameTitleCase(str) {
  return str.toLowerCase().replace(/(^|[\s.''-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
}

function parseFilmForum($) {
  const image = $('meta[property="og:image"]').attr('content') || null;

  const description = $('p').toArray()
    .map(el => $(el).text().replace(/\s+/g, ' ').trim())
    .filter(t => t.length > 100 && !/^(Presented with|Become a Member)/.test(t))
    .reduce((best, t) => (!best || t.length > best.length ? t : best), null);

  const body = $('main').text().replace(/\s+/g, ' ');
  // New releases: "DIRECTED BY MARIANNA BRENNAND ... 2024 107 MIN."
  // Revivals:     "U.S., 1953 Directed by Henry Hathaway Starring ..."
  const dirM   = body.match(/DIRECTED BY\s+([A-Z][A-Z.''\- ]+?)(?=\s+(?:EXECUTIVE|PRODUCED|WINNER|—|\||$))/);
  const ymRtM  = body.match(/(\d{4})\s+(\d{2,3})\s*MIN\b/);
  const revM   = body.match(/\b(\d{4})\s+Directed by\s+([A-Z][a-zà-ÿ.''-]+(?:\s+[A-Z][a-zà-ÿ.''-]+){0,3})(?=\s+(?:Starring|—|\.|$))/);

  return {
    image, description,
    director: dirM ? nameTitleCase(dirM[1].trim()) : (revM ? revM[2].trim() : null),
    year:     ymRtM ? ymRtM[1] : (revM ? revM[1] : null),
    runtime:  ymRtM ? `${ymRtM[2]} min` : null,
  };
}

// Event pages render an og:description synopsis plus a line like:
// "Dir. Yoji Yamada, 2025, 103 min., DCP, color, in Japanese with English subtitles. With ..."
function parseJapanSociety($) {
  const description = $('meta[property="og:description"]').attr('content')?.trim() || null;
  const body = $('body').text().replace(/\s+/g, ' ');

  let director = null, year = null, runtime = null, language = null;
  const m = body.match(/Dir\.\s*([^,]+),\s*(\d{4}),\s*(\d{2,3})\s*min/i);
  if (m) { director = m[1].trim(); year = m[2]; runtime = `${m[3]} min`; }

  const langM = body.match(/in\s+([A-Z][a-z]+)\s+with English subtitles/);
  if (langM) language = langM[1];

  return { description, director, year, runtime, language };
}

function parseSpectacle($) {
  const image = $('meta[property="og:image"]').attr('content') || null;

  const description = $('.entry-content p').toArray()
    .map(el => $(el).text().replace(/\s+/g, ' ').trim())
    .filter(t => t.length > 80 && !/^Posted in/.test(t))
    .reduce((best, t) => (!best || t.length > best.length ? t : best), null);

  return { image, description };
}

function parseLAlliance($) {
  const image = $('meta[property="og:image"]').attr('content') || null;

  // Event body renders as <div class="event-description">...<div class="brxe-text">
  //   <p class="p1">Dir. NAME, YEAR, RUNTIME min, FORMAT</p>
  //   <p class="p1">Synopsis text...</p>
  const paras = $('.event-description p.p1').toArray()
    .map(el => $(el).text().replace(/\s+/g, ' ').trim());

  const meta = paras[0] || '';
  const m = meta.match(/Dir\.\s*([^,]+),\s*(\d{4})(?:,\s*(\d{2,3})\s*min)?/i);

  const description = paras.slice(1)
    .filter(t => t.length > 60)
    .reduce((best, t) => (!best || t.length > best.length ? t : best), null);

  return {
    image, description,
    director: m ? nameTitleCase(m[1].trim()) : null,
    year:     m ? m[2] : null,
    runtime:  m && m[3] ? `${m[3]} min` : null,
  };
}

function parseBAM($) {
  const image       = $('meta[property="og:image"]').attr('content') || null;
  const description = $('meta[property="og:description"]').attr('content') || null;

  const dirText = $('.directedByText').first().text().replace(/\s+/g, ' ').trim();
  const dirM    = dirText.match(/Directed by\s+(.+?)\s*\((\d{4})\)/);

  let runtime = null;
  $('h2').each((i, el) => {
    if ($(el).text().trim().toUpperCase() === 'RUNNING TIME') {
      const m = $(el).next('.bam-block-hero-details').text().match(/(\d{2,3})\s*min/i);
      if (m) runtime = `${m[1]} min`;
    }
  });

  return {
    image, description,
    director: dirM ? dirM[1].trim() : null,
    year:     dirM ? dirM[2] : null,
    runtime,
  };
}

// Checkout pages only carry an og:image poster (no real synopsis — og:description
// is just a generated "Get tickets for X on DATE at TIME" blurb).
function parseLowCinema($) {
  const image = $('meta[property="og:image"]').attr('content') || null;
  return { image };
}

// ─── Main fetch + cache logic ─────────────────────────────────────────────────

async function fetchFilmDetails(url) {
  if (!url) return {};

  const cached = getCached(url);
  if (cached !== null) return cached;

  try {
    const { data } = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 10000 });
    const $ = cheerio.load(data);

    let details = {};
    if (url.includes('thecinematheque.ca')) details = parseCinemathque($);
    else if (url.includes('theparktheatre.ca')) details = parsePark($);
    else if (url.includes('riotheatre.ca')) details = parsePark($); // same page structure as Park
    else if (url.includes('viff.org')) details = parseViffFilm($);
    else if (url.includes('metrograph.com')) details = parseMetrograph($);
    else if (url.includes('ifccenter.com')) details = parseIFC($);
    else if (url.includes('roxycinemanewyork.com')) details = parseRoxy($);
    else if (url.includes('nitehawkcinema.com')) details = parseNitehawk($);
    else if (url.includes('quadcinema.com')) details = parseQuad($);
    else if (url.includes('atomtickets.com')) details = parseAtomFilm($);
    else if (url.includes('filmforum.org')) details = parseFilmForum($);
    else if (url.includes('spectacletheater.com')) details = parseSpectacle($);
    else if (url.includes('lallianceny.org')) details = parseLAlliance($);
    else if (url.includes('bam.org')) details = parseBAM($);
    else if (url.includes('lowcinema.com')) details = parseLowCinema($);
    else if (url.includes('japansociety.org')) details = parseJapanSociety($);

    setCached(url, details);
    return details;
  } catch (err) {
    console.warn(`  [film-details] ${url.split('/').slice(-2).join('/')}: ${err.message}`);
    const empty = {};
    setCached(url, empty);
    return empty;
  }
}

// Enrich screenings with image/description/director/year/country/language/runtime.
// Deduplicates by filmUrl. Merges without overwriting already-set fields.
async function enrichScreenings(screenings) {
  // Fetch film pages for any screening that has a filmUrl and is missing any metadata field
  const needsEnrichment = screenings.filter(s =>
    s.filmUrl && (!s.country || !s.language || !s.year || !s.runtime || !s.image)
  );
  const uniqueUrls = [...new Set(needsEnrichment.map(s => s.filmUrl))];

  if (uniqueUrls.length === 0) return screenings;
  console.log(`  Fetching details for ${uniqueUrls.length} films...`);

  const detailsMap = {};

  for (let i = 0; i < uniqueUrls.length; i += CONCURRENCY) {
    const batch = uniqueUrls.slice(i, i + CONCURRENCY);
    const res = await Promise.allSettled(batch.map(url => fetchFilmDetails(url)));
    batch.forEach((url, j) => {
      detailsMap[url] = res[j].status === 'fulfilled' ? res[j].value : {};
    });
  }

  return screenings.map(s => {
    if (!s.filmUrl) return s;
    const d = detailsMap[s.filmUrl] || {};
    // Merge: only fill fields that aren't already set on the screening
    const merged = { ...s };
    for (const [k, v] of Object.entries(d)) {
      const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
      const alreadySet = merged[k] != null && merged[k] !== '' && !(Array.isArray(merged[k]) && merged[k].length === 0);
      if (!empty && !alreadySet) merged[k] = v;
    }
    return merged;
  });
}

module.exports = { enrichScreenings };
