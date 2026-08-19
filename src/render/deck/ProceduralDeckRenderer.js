// render/deck/ProceduralDeckRenderer... (alias)
//
// Canvas-based deck renderer. Draws each card face (and the back) onto an
// offscreen canvas and returns a data URL consumable as a CSS background-image
// by CardView. Faces show a corner rank+suit index plus a large centered
// rank+suit in the card body. Results are cached per (suit, rank).
//
// Must remain framework-free (no React/DOM-logic imports) so the core stays
// unit-testable; only the browser `document` canvas API is used here.
//
// Drawing primitives are shared with SpriteDeckRenderer via drawCard.js.

import { registerDeck } from './deckRegistry.js';
import { drawCardFace, drawCardBack } from './drawCard.js';

/**
 * @implements {import('./deckRegistry.js').DeckRenderer}
 */
export function createProceduralDeckRenderer({ size = 96, colorFor } = {}) {
  const w = size;
  const h = Math.round(size * 1.4);
  const cache = new Map();

  /** @param {string} key */
  function makeCanvas(key) {
    if (cache.has(key)) return cache.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    cache.set(key, { canvas, ctx });
    return { canvas, ctx };
  }

  return {
    name: 'procedural',

    /**
     * @param {string} suit
     * @param {number} rank
     * @returns {string}
     */
    renderCard(suit, rank) {
      const key = `card:${suit}:${rank}`;
      if (cache.has(key)) return cache.get(key).canvas.toDataURL('image/png');

      const { canvas, ctx } = makeCanvas(key);
      drawCardFace(ctx, suit, rank, w, h, colorFor);
      return canvas.toDataURL('image/png');
    },

    /**
     * @returns {string}
     */
    renderBack() {
      const key = 'back';
      if (cache.has(key)) return cache.get(key).canvas.toDataURL('image/png');

      const { canvas, ctx } = makeCanvas(key);
      drawCardBack(ctx, w, h);
      return canvas.toDataURL('image/png');
    },

    dispose() {
      cache.clear();
    },
  };
}

registerDeck('procedural', createProceduralDeckRenderer());

// 4-color deck: hearts red, spades black, clubs green, diamonds blue.
const FOUR_COLOR = {
  hearts: '#d12b3b',
  spades: '#1d2330',
  clubs: '#1e8a3b',
  diamonds: '#1f6fd6',
};

// 4-color deck #2: clubs black, diamonds yellow, hearts red, spades green.
const FOUR_COLOR_2 = {
  clubs: '#1d2330',
  diamonds: '#e0a800',
  hearts: '#d12b3b',
  spades: '#1e8a3b',
};

registerDeck('4-color', createProceduralDeckRenderer({ colorFor: (s) => FOUR_COLOR[s] }));
registerDeck('4-color-2', createProceduralDeckRenderer({ colorFor: (s) => FOUR_COLOR_2[s] }));
