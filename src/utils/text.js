'use strict';

const SMALL_WORDS = new Set(['a','an','and','as','at','but','by','for','in','of','on','or','the','to','vs','with']);

// Converts ALL-CAPS film titles ("AGATHA'S ALMANAC" -> "Agatha's Almanac")
// to mixed case to match the other NY theaters' listings.
function toTitleCase(str) {
  const words = str.toLowerCase().split(/(\s+)/);
  let seenWord = false;
  return words.map((word, i) => {
    if (/^\s+$/.test(word) || !word) return word;
    const isLast = !words.slice(i + 1).some(w => !/^\s+$/.test(w));
    const keepLower = seenWord && !isLast && SMALL_WORDS.has(word);
    seenWord = true;
    return keepLower ? word : word.charAt(0).toUpperCase() + word.slice(1);
  }).join('');
}

module.exports = { toTitleCase };
