// render/deck/cardBackRegistry.js
//
// Purchasable card-back overrides, independent of the active deck face
// renderer (see deckRegistry.js). 'default' is NOT registered here — it's
// a sentinel in useSettingsStore meaning "use the active deck's own back,"
// resolved in CardView.jsx. Every key here should correspond to a
// store_items row (kind='card_back') whose asset_ref matches it.

import { drawCardBack } from './drawCard.js';

const cache = new Map();

function render(key, baseColor, pattern = 'diagonal', size = 96) {
  const w = size;
  const h = Math.round(size * 1.4);
  const cacheKey = `${key}:${w}x${h}:${pattern}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  drawCardBack(ctx, w, h, { baseColor, pattern });
  const url = canvas.toDataURL('image/png');
  cache.set(cacheKey, url);
  return url;
}

const BACKS = {
  red: { name: 'Red', renderBack: () => render('red', '#7a1f2b', 'diagonal') },
  green: { name: 'Green', renderBack: () => render('green', '#118324', 'diagonal') },
  black: { name: 'Black', renderBack: () => render('black', '#0e0202', 'hex') },
  golden: { name: 'Golden', renderBack: () => render('golden', '#a67c00', 'damask') },
  purple: { name: 'Purple', renderBack: () => render('purple', '#5e065e', 'waves') },
  gray: { name: 'Gray', renderBack: () => render('gray', '#262727', 'houndstooth') },
  navy: { name: 'Navy Houndstooth', renderBack: () => render('navy', '#1a2a4a', 'houndstooth') },
  crimsonDamask: { name: 'Crimson Damask', renderBack: () => render('crimsonDamask', '#6b1a2a', 'damask') },
  emeraldLinen: { name: 'Emerald Linen', renderBack: () => render('emeraldLinen', '#0d3b2e', 'linen') },
  midnightHex: { name: 'Midnight Hex', renderBack: () => render('midnightHex', '#0a1020', 'hex') },
  desertWaves: { name: 'Desert Waves', renderBack: () => render('desertWaves', '#8c6a43', 'waves') },
  ivoryDamask: { name: 'Ivory Damask', renderBack: () => render('ivoryDamask', '#2b2e3a', 'damask') },
};

export function getCardBack(key) {
  return BACKS[key];
}
