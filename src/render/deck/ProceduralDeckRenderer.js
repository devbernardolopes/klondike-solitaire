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
import { drawCardFace, drawCardBack, drawSuitGlyphDataURL } from './drawCard.js';

/**
 * @implements {import('./deckRegistry.js').DeckRenderer}
 */
export function createProceduralDeckRenderer({ size = 96, faceOptions } = {}) {
  const w = size;
  const h = Math.round(size * 1.4);
  // Cache the encoded data-URL string (not the raw canvas), so repeated renders
  // — e.g. every card remounting on a new deal — reuse the PNG instead of
  // re-running the expensive toDataURL() encode each time.
  const cache = new Map();

  /** @param {string} key @param {(ctx: CanvasRenderingContext2D) => void} draw */
  function render(key, draw) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    draw(ctx);
    const url = canvas.toDataURL('image/png');
    cache.set(key, url);
    return url;
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
      return render(key, (ctx) => drawCardFace(ctx, suit, rank, w, h, faceOptions));
    },

    /**
     * @returns {string}
     */
    renderBack() {
      return render('back', (ctx) => drawCardBack(ctx, w, h));
    },

    /**
     * Transparent suit-glyph data URL in the deck's own colors (used by the
     * foundation particle burst). Cached per suit.
     * @param {string} suit
     * @returns {string}
     */
    renderSuit(suit) {
      const key = `suit:${suit}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const color = (faceOptions?.colorFor ?? colorOf)(suit);
      const url = drawSuitGlyphDataURL(suit, () => color, w);
      cache.set(key, url);
      return url;
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

registerDeck('4-color', createProceduralDeckRenderer({ faceOptions: { colorFor: (s) => FOUR_COLOR[s] } }));
registerDeck('4-color-2', createProceduralDeckRenderer({ faceOptions: { colorFor: (s) => FOUR_COLOR_2[s] } }));

// Dark deck: no white face. Suit colors are brightened so the black suits
// (spades/clubs) remain readable on the dark slate background.
const DARK_COLOR = {
  hearts: '#ff6b7a',
  diamonds: '#ff8a5c',
  spades: '#e8ecf4',
  clubs: '#c7d2fe',
};

registerDeck(
  'procedural-dark',
  createProceduralDeckRenderer({
    faceOptions: {
      colorFor: (s) => DARK_COLOR[s],
      background: '#232936',
      border: 'rgba(255,255,255,0.22)',
    },
  })
);

// Dark 2: same dark slate face, but strictly 2-color (reddish + blueish).
// Red suits (hearts/diamonds) use coral-red; black suits (spades/clubs) sky-blue.
const DARK_2_COLOR = {
  hearts: '#ff5d6c',
  diamonds: '#ff5d6c',
  spades: '#5b8def',
  clubs: '#5b8def',
};

registerDeck(
  'procedural-dark-2',
  createProceduralDeckRenderer({
    faceOptions: {
      colorFor: (s) => DARK_2_COLOR[s],
      background: '#232936',
      border: 'rgba(255,255,255,0.22)',
    },
  })
);
