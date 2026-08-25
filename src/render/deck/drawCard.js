// render/deck/drawCard.js
//
// Shared canvas drawing primitives for card faces and backs. Used by both the
// ProceduralDeckRenderer (which draws each card directly) and the
// SpriteDeckRenderer (which composes an atlas and slices it). Keeping the
// drawing logic in one place guarantees both renderers produce identical art.
//
// Must remain framework-free (no React/DOM-logic imports) so the core stays
// unit-testable; only the browser `document` canvas API is used here.

export const SUIT_GLYPH = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

export const RANK_LABEL = {
  1: 'A',
  11: 'J',
  12: 'Q',
  13: 'K',
};

export function rankLabel(rank) {
  return RANK_LABEL[rank] ?? String(rank);
}

export function colorOf(suit) {
  return suit === 'hearts' || suit === 'diamonds' ? '#d12b3b' : '#1d2330';
}

export function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawGlyph(ctx, text, color, x, y, fontPx, flip) {
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

/**
 * Draw a full card face (rank + suit, corner indices, large centered body) into
 * the given context, filling the rectangle [0,0,w,h].
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} suit  'hearts'|'diamonds'|'clubs'|'spades'
 * @param {number} rank  1..13
 * @param {number} w     card width in px
 * @param {number} h     card height in px
 * @param {object} [opts]
 * @param {(suit: string) => string} [opts.colorFor]  color resolver; defaults to
 *        the classic red/black scheme. Pass a custom function for 4-color decks
 *        or a light-brightened palette for dark decks.
 * @param {string} [opts.background]  card face fill; defaults to off-white.
 * @param {string} [opts.border]      card face stroke; defaults to a faint black.
 */
export function drawCardFace(ctx, suit, rank, w, h, { colorFor = colorOf, background = '#fbfbf7', border = 'rgba(0,0,0,0.18)' } = {}) {
  const radius = Math.max(4, Math.round(w * 0.07));
  const color = colorFor(suit);
  const glyph = SUIT_GLYPH[suit];
  const label = rankLabel(rank);

  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.fillStyle = background;
  ctx.fill();
  ctx.lineWidth = Math.max(1, w * 0.012);
  ctx.strokeStyle = border;
  ctx.stroke();

  // Corner indices (top-left, and mirrored bottom-right).
  const cornerFont = Math.round(w * 0.2);
  const cornerX = w * 0.2;
  const cornerTopY = w * 0.26;
  const cornerBotY = h - w * 0.26;
  drawGlyph(ctx, label, color, cornerX, cornerTopY, cornerFont, false);
  drawGlyph(ctx, glyph, color, cornerX, cornerTopY + cornerFont * 0.9, cornerFont, false);
  drawGlyph(ctx, label, color, w - cornerX, cornerBotY, cornerFont, true);
  drawGlyph(ctx, glyph, color, w - cornerX, cornerBotY - cornerFont * 0.9, cornerFont, true);

  // Large centered rank + suit in the body.
  const centerFont = Math.round(w * 0.5);
  const cx = w / 2;
  const cy = h / 2;
  drawGlyph(ctx, label, color, cx, cy - centerFont * 0.45, centerFont, false);
  drawGlyph(ctx, glyph, color, cx, cy + centerFont * 0.55, centerFont, false);
}

/**
 * Render a single suit glyph as a transparent data URL, sized `size` x `size`.
 * Used by the foundation particle burst so each particle shows the exact deck-
 * colored suit symbol. Has no dependency on a card face, so it composes with
 * any renderer's own color resolver.
 * @param {string} suit  'hearts'|'diamonds'|'clubs'|'spades'
 * @param {(suit: string) => string} [colorFor]  color resolver; defaults to the
 *        classic red/black scheme.
 * @param {number} [size]  output square side in px (default 64).
 * @returns {string} a `data:image/png` URL
 */
export function drawSuitGlyphDataURL(suit, colorFor = colorOf, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const color = colorFor(suit);
  const glyph = SUIT_GLYPH[suit];
  // Glyph fills most of the square; slightly above center reads better visually.
  drawGlyph(ctx, glyph, color, size / 2, size / 2, Math.round(size * 0.82), false);
  return canvas.toDataURL('image/png');
}

/**
 * Draw a card back (repeating diagonal motif) into the given context, filling
 * the rectangle [0,0,w,h].
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 */
export function drawCardBack(ctx, w, h) {
  const radius = Math.max(4, Math.round(w * 0.07));

  roundRect(ctx, 0, 0, w, h, radius);
  ctx.fillStyle = '#2b3a67';
  ctx.fill();

  // Simple repeating diagonal motif.
  ctx.save();
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = Math.max(1, w * 0.04);
  const step = w * 0.28;
  for (let i = -h; i < w; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + h, h);
    ctx.stroke();
  }
  ctx.restore();

  roundRect(ctx, w * 0.08, w * 0.08, w - w * 0.16, h - w * 0.16, radius * 0.7);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = Math.max(1, w * 0.02);
  ctx.stroke();
}
