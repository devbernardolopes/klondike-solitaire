// render/deck/cardBackRegistry.js
//
// Purchasable card-back overrides, independent of the active deck face
// renderer (see deckRegistry.js). 'default' is NOT registered here — it's
// a sentinel in useSettingsStore meaning "use the active deck's own back,"
// resolved in CardView.jsx. Every key here should correspond to a
// store_items row (kind='card_back') whose asset_ref matches it.

import { drawCardBack } from './drawCard.js';

const cache = new Map();

function render(key, baseColor, size = 96) {
  const w = size;
  const h = Math.round(size * 1.4);
  const cacheKey = `${key}:${w}x${h}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  drawCardBack(ctx, w, h, { baseColor });
  const url = canvas.toDataURL('image/png');
  cache.set(cacheKey, url);
  return url;
}

const BACKS = {
  red: { name: 'Red', renderBack: () => render('red', '#7a1f2b') },
  green: { name: 'Green', renderBack: () => render('green', '#118324') },
  black: { name: 'Black', renderBack: () => render('black', '#0e0202') },
  golden: { name: 'Golden', renderBack: () => render('golden', '#a67c00') },
  purple: { name: 'Purple', renderBack: () => render('purple', '#5e065e') },
  gray: { name: 'Gray', renderBack: () => render('gray', '#262727') },
};

export function getCardBack(key) {
  return BACKS[key];
}
