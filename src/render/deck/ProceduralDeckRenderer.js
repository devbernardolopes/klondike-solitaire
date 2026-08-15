// render/deck/ProceduralDeckRenderer.js
//
// Canvas-based deck renderer. Draws each card face (and the back) onto an
// offscreen canvas and returns a data URL consumable as a CSS background-image
// by CardView. Faces show a corner rank+suit index plus a large centered
// rank+suit in the card body. Results are cached per (suit, rank).
//
// Must remain framework-free (no React/DOM-logic imports) so the core stays
// unit-testable; only the browser `document` canvas API is used here.

import { registerDeck } from './deckRegistry.js';

const SUIT_GLYPH = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

const RANK_LABEL = {
  1: 'A',
  11: 'J',
  12: 'Q',
  13: 'K',
};

function rankLabel(rank) {
  return RANK_LABEL[rank] ?? String(rank);
}

function colorOf(suit) {
  return suit === 'hearts' || suit === 'diamonds' ? '#d12b3b' : '#1d2330';
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * @implements {import('./deckRegistry.js').DeckRenderer}
 */
export function createProceduralDeckRenderer({ size = 96 } = {}) {
  const w = size;
  const h = Math.round(size * 1.4);
  const radius = Math.max(4, Math.round(size * 0.07));
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

  function drawCorner(ctx, text, color, x, y, fontPx, flip) {
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.rotate(Math.PI);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${fontPx}px system-ui, sans-serif`;
    ctx.fillText(text, 0, 0);
    ctx.restore();
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
      const color = colorOf(suit);
      const glyph = SUIT_GLYPH[suit];
      const label = rankLabel(rank);

      // Card face background.
      ctx.clearRect(0, 0, w, h);
      roundRect(ctx, 0, 0, w, h, radius);
      ctx.fillStyle = '#fbfbf7';
      ctx.fill();
      ctx.lineWidth = Math.max(1, size * 0.012);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.stroke();

      // Corner indices (top-left, and mirrored bottom-right).
      const cornerFont = Math.round(size * 0.2);
      const cornerX = size * 0.2;
      const cornerTopY = size * 0.26;
      const cornerBotY = h - size * 0.26;
      drawCorner(ctx, label, color, cornerX, cornerTopY, cornerFont, false);
      drawCorner(ctx, glyph, color, cornerX, cornerTopY + cornerFont * 0.9, cornerFont, false);
      drawCorner(ctx, label, color, w - cornerX, cornerBotY, cornerFont, true);
      drawCorner(ctx, glyph, color, w - cornerX, cornerBotY - cornerFont * 0.9, cornerFont, true);

      // Large centered rank + suit in the body.
      const centerFont = Math.round(size * 0.5);
      const cx = w / 2;
      const cy = h / 2;
      drawCorner(ctx, label, color, cx, cy - centerFont * 0.45, centerFont, false);
      drawCorner(ctx, glyph, color, cx, cy + centerFont * 0.55, centerFont, false);

      return canvas.toDataURL('image/png');
    },

    /**
     * @returns {string}
     */
    renderBack() {
      const key = 'back';
      if (cache.has(key)) return cache.get(key).canvas.toDataURL('image/png');

      const { canvas, ctx } = makeCanvas(key);

      roundRect(ctx, 0, 0, w, h, radius);
      ctx.fillStyle = '#2b3a67';
      ctx.fill();

      // Simple repeating diagonal motif.
      ctx.save();
      roundRect(ctx, 0, 0, w, h, radius);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = Math.max(1, size * 0.04);
      const step = size * 0.28;
      for (let i = -h; i < w; i += step) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + h, h);
        ctx.stroke();
      }
      ctx.restore();

      roundRect(ctx, size * 0.08, size * 0.08, w - size * 0.16, h - size * 0.16, radius * 0.7);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(1, size * 0.02);
      ctx.stroke();

      return canvas.toDataURL('image/png');
    },

    dispose() {
      cache.clear();
    },
  };
}

registerDeck('procedural', createProceduralDeckRenderer());
