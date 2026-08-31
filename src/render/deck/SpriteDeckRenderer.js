// render/deck/SpriteDeckRenderer.js
//
// Atlas-based deck renderer. Unlike the ProceduralDeckRenderer (which draws each
// card onto its own canvas), this renderer composes ALL 52 faces plus the card
// back onto a SINGLE atlas canvas at startup, then returns per-card art by
// SLICING the appropriate source rectangle into a small canvas and exporting a
// data URL. This exercises the real atlas-slicing code path and stays distinct
// from the direct-draw procedural renderer — no binary asset is required.
//
// Must remain framework-free (no React/DOM-logic imports); only the browser
// `document` canvas API is used.

import { registerDeck } from './deckRegistry.js';
import { drawCardFace, drawCardBack, colorOf, drawLargeValueCardFace } from './drawCard.js';

// Row order in the atlas, indexed by rank 1..13 in columns.
const ATLAS_SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];

/**
 * @implements {import('./deckRegistry.js').DeckRenderer}
 */
export function createSpriteDeckRenderer({ size = 120, atlasPath, largeValue = false } = {}) {
  const w = size;
  const h = Math.round(size * 1.4);
  const cols = 13; // ranks 1..13
  const rows = 5; // 4 suit rows + 1 back row

  let atlas = null; // { canvas, ctx }
  const cache = new Map();

  /** Build the atlas once, lazily, on first use. */
  function ensureAtlas() {
    if (atlas) return atlas;
    const canvas = document.createElement('canvas');
    canvas.width = w * cols;
    canvas.height = h * rows;
    const ctx = canvas.getContext('2d');
    // Faces: row = suit index, col = rank-1.
    ATLAS_SUITS.forEach((suit, r) => {
      for (let rank = 1; rank <= 13; rank++) {
        ctx.save();
        ctx.translate((rank - 1) * w, r * h);
        if (largeValue) {
          drawLargeValueCardFace(ctx, suit, rank, w, h);
        } else {
          drawCardFace(ctx, suit, rank, w, h);
        }
        ctx.restore();
      }
    });
    // Back: first column of the final (5th) row.
    ctx.save();
    ctx.translate(0, 4 * h);
    drawCardBack(ctx, w, h);
    ctx.restore();
    atlas = { canvas, ctx };
    return atlas;
  }

  /** Slice a source rect from the atlas into a fresh canvas → data URL. */
  function slice(sx, sy, key) {
    if (cache.has(key)) return cache.get(key);
    const { canvas: atlasCanvas } = ensureAtlas();
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    octx.drawImage(atlasCanvas, sx, sy, w, h, 0, 0, w, h);
    const url = out.toDataURL('image/png');
    cache.set(key, url);
    return url;
  }

  return {
    name: largeValue ? 'sprite-large-value' : 'sprite',

    /**
     * @param {string} suit
     * @param {number} rank
     * @returns {string}
     */
    renderCard(suit, rank) {
      const r = ATLAS_SUITS.indexOf(suit);
      if (r === -1) throw new Error(`SpriteDeckRenderer: unknown suit ${suit}`);
      const sx = (rank - 1) * w;
      const sy = r * h;
      return slice(sx, sy, `card:${suit}:${rank}`);
    },

    /**
     * @returns {string}
     */
    renderBack() {
      return slice(0, 4 * h, 'back');
    },

    /**
     * Transparent suit-glyph data URL (used by the foundation particle burst).
     * The sprite atlas has no glyph-only row, so generate it directly and cache.
     * @param {string} suit
     * @returns {string}
     */
    suitColor(suit) {
      return colorOf(suit);
    },

    dispose() {
      atlas = null;
      cache.clear();
    },
  };
}

registerDeck('sprite', createSpriteDeckRenderer());
registerDeck('sprite-large-value', createSpriteDeckRenderer({ largeValue: true }));
