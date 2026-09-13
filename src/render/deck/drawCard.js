// render/deck/drawCard.js
//
// Shared canvas drawing primitives for card faces and backs. Used by
// ProceduralDeckRenderer, which draws each card directly onto its own
// canvas. Keeping the drawing logic in one place keeps every deck variant
// visually consistent.
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

/**
 * Card-face layout metrics (fractions of w/h). Single source of truth for the
 * draw functions below AND the numeric layout tests
 * (`cardLayout.test.js`) — change the numbers here, never inline.
 *
 * The corner index is a single side-by-side row (rank + suit sharing one cap
 * height) instead of a stacked two-line index, so the suit stays legible at
 * small card sizes and the row uses horizontal rather than vertical space.
 * The pip field is pushed down (top 0.21h) to clear that row; pip columns are
 * slightly narrowed (0.345/0.655) for horizontal air. Pip sizes are untouched.
 */
export const CARD_LAYOUT = {
  cornerFontRatio: 0.20,
  /** Top/bottom row-center distance from the near edge, ÷ h. */
  cornerRowYRatio: 0.095,
  /** Rank glyph center x for the top-left row, ÷ w. */
  rankCenterXRatio: 0.13,
  /** Gap between rank and suit in the corner row, ÷ w. */
  cornerGapRatio: 0.03,
  /** Pip field top ÷ h (clears the corner row). */
  pipTopRatio: 0.21,
  /** Pip field height ÷ h. */
  pipHeightRatio: 0.58,
  /** Pip column centers, ÷ w (middle column is 0.5). */
  pipColL: 0.345,
  pipColR: 0.655,
  /** Pip glyph sizes, ÷ w (ranks 2-6 big, 7-10 small). Unchanged. */
  pipSizeBigRatio: 0.22,
  pipSizeSmallRatio: 0.18,
};

/** Corner index font size in px for a card of width w. */
export function cornerFontPx(w) {
  return Math.round(w * CARD_LAYOUT.cornerFontRatio);
}

/** Pip glyph size in px for a card of width w and the given rank. */
export function pipSizePx(w, rank) {
  return Math.round(w * (rank <= 6 ? CARD_LAYOUT.pipSizeBigRatio : CARD_LAYOUT.pipSizeSmallRatio));
}

/**
 * Map a pip-layout point (x: 0..1 fraction of w, y: 0.26..0.74 layout space)
 * into card px coordinates.
 */
export function pipPoint(px, py, w, h) {
  return {
    x: w * px,
    y: h * (CARD_LAYOUT.pipTopRatio + CARD_LAYOUT.pipHeightRatio * ((py - 0.26) / 0.48)),
  };
}

/**
 * Lay out the side-by-side corner index row for a card of w×h.
 * @param {number} w card width in px
 * @param {number} h card height in px
 * @param {number} rankWidthPx measured width of the rank label at the corner font
 * @param {number} suitWidthPx measured width of the suit glyph at the corner font
 * @returns positions for the top-left row plus its 180°-rotated bottom-right
 *   mirror (canvas coords: the suit sits LEFT of the rank there so a viewer
 *   rotating the card reads rank-then-suit), plus the row bounding box.
 */
export function layoutCornerRow(w, h, rankWidthPx, suitWidthPx) {
  const fontPx = cornerFontPx(w);
  const rowY = h * CARD_LAYOUT.cornerRowYRatio;
  const rankX = w * CARD_LAYOUT.rankCenterXRatio;
  const suitX = rankX + rankWidthPx / 2 + w * CARD_LAYOUT.cornerGapRatio + suitWidthPx / 2;
  const botRowY = h - rowY;
  return {
    fontPx,
    rankX,
    suitX,
    rowY,
    botRankX: w - rankX,
    botSuitX: w - suitX,
    botRowY,
    left: rankX - rankWidthPx / 2,
    right: suitX + suitWidthPx / 2,
    top: rowY - fontPx / 2,
    bottom: rowY + fontPx / 2,
  };
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

function drawGlyph(ctx, text, color, x, y, fontPx, flip, weight = 700) {
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.rotate(Math.PI);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${weight} ${fontPx}px system-ui, sans-serif`;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawUnderline(ctx, color, x, y, w, flip) {
  const len = w * 0.22;
  const thickness = Math.max(1, w * 0.022);
  const offsetY = w * 0.06;
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.rotate(Math.PI);
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-len / 2, offsetY);
  ctx.lineTo(len / 2, offsetY);
  ctx.stroke();
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
 * @param {(suit: string) => number} [opts.weightFor]  font weight resolver; defaults to 700.
 * @param {(suit: string) => string} [opts.decorationFor]  returns 'underline' to add a non-color cue beneath corner suit glyphs.
 */
export const PIP_LAYOUTS = {
  2: [{ x: 0.5, y: 0.30 }, { x: 0.5, y: 0.70, flip: true }],
  3: [{ x: 0.5, y: 0.26 }, { x: 0.5, y: 0.50 }, { x: 0.5, y: 0.74, flip: true }],
  4: [{ x: 0.345, y: 0.28 }, { x: 0.655, y: 0.28 }, { x: 0.345, y: 0.72, flip: true }, { x: 0.655, y: 0.72, flip: true }],
  5: [{ x: 0.345, y: 0.28 }, { x: 0.655, y: 0.28 }, { x: 0.5, y: 0.50 }, { x: 0.345, y: 0.72, flip: true }, { x: 0.655, y: 0.72, flip: true }],
  6: [{ x: 0.345, y: 0.28 }, { x: 0.655, y: 0.28 }, { x: 0.345, y: 0.50 }, { x: 0.655, y: 0.50 }, { x: 0.345, y: 0.72, flip: true }, { x: 0.655, y: 0.72, flip: true }],
  7: [{ x: 0.345, y: 0.28 }, { x: 0.655, y: 0.28 }, { x: 0.5, y: 0.38 }, { x: 0.345, y: 0.50 }, { x: 0.655, y: 0.50 }, { x: 0.345, y: 0.72, flip: true }, { x: 0.655, y: 0.72, flip: true }],
  8: [{ x: 0.345, y: 0.28 }, { x: 0.655, y: 0.28 }, { x: 0.5, y: 0.38 }, { x: 0.345, y: 0.50 }, { x: 0.655, y: 0.50 }, { x: 0.5, y: 0.62, flip: true }, { x: 0.345, y: 0.72, flip: true }, { x: 0.655, y: 0.72, flip: true }],
  9: [{ x: 0.345, y: 0.28 }, { x: 0.655, y: 0.28 }, { x: 0.345, y: 0.42 }, { x: 0.655, y: 0.42 }, { x: 0.5, y: 0.50 }, { x: 0.345, y: 0.58, flip: true }, { x: 0.655, y: 0.58, flip: true }, { x: 0.345, y: 0.72, flip: true }, { x: 0.655, y: 0.72, flip: true }],
  10: [{ x: 0.345, y: 0.26 }, { x: 0.655, y: 0.26 }, { x: 0.5, y: 0.34 }, { x: 0.345, y: 0.42 }, { x: 0.655, y: 0.42 }, { x: 0.345, y: 0.58, flip: true }, { x: 0.655, y: 0.58, flip: true }, { x: 0.5, y: 0.66, flip: true }, { x: 0.345, y: 0.74, flip: true }, { x: 0.655, y: 0.74, flip: true }],
};

export function drawCardFace(ctx, suit, rank, w, h, { colorFor = colorOf, background = '#fbfbf7', border = 'rgba(0,0,0,0.18)', weightFor, decorationFor } = {}) {
  const radius = Math.max(4, Math.round(w * 0.07));
  const color = colorFor(suit);
  const weight = weightFor ? weightFor(suit) : 700;
  const decoration = decorationFor ? decorationFor(suit) : null;
  const glyph = SUIT_GLYPH[suit];
  const label = rankLabel(rank);

  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.fillStyle = background;
  ctx.fill();
  ctx.save();
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.clip();
  const grad = ctx.createLinearGradient(0, 0, 0, h * 0.22);
  grad.addColorStop(0, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h * 0.22);
  const innerGrad = ctx.createLinearGradient(0, h * 0.78, 0, h);
  innerGrad.addColorStop(0, 'rgba(0,0,0,0)');
  innerGrad.addColorStop(1, 'rgba(0,0,0,0.07)');
  ctx.fillStyle = innerGrad;
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
  ctx.restore();
  ctx.lineWidth = Math.max(1, w * 0.012);
  ctx.strokeStyle = border;
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.stroke();
  ctx.save();
  roundRect(ctx, 1, 1, w - 2, h - 2, radius * 0.85);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(1, w * 0.01);
  ctx.stroke();
  ctx.restore();

  // Side-by-side corner index: rank + suit share one row (top-left, mirrored
  // bottom-right) so the suit stays legible at small card sizes. Positions
  // come from layoutCornerRow (single source of truth with the layout tests);
  // the suit is measured so the row hugs the actual glyphs. The bottom row is
  // the 180° rotation of the top row, so a viewer rotating the card reads
  // rank-then-suit there too. Underlines (non-color suit cue) face the card
  // center on both rows.
  const cornerFont = cornerFontPx(w);
  ctx.font = `${weight} ${cornerFont}px system-ui, sans-serif`;
  const corner = layoutCornerRow(w, h, ctx.measureText(label).width, ctx.measureText(glyph).width);
  drawGlyph(ctx, label, color, corner.rankX, corner.rowY, cornerFont, false, weight);
  drawGlyph(ctx, glyph, color, corner.suitX, corner.rowY, cornerFont, false, weight);
  if (decoration === 'underline') {
    drawUnderline(ctx, color, corner.suitX, corner.rowY + cornerFont * 0.32, w, false);
  }
  drawGlyph(ctx, glyph, color, corner.botSuitX, corner.botRowY, cornerFont, true, weight);
  drawGlyph(ctx, label, color, corner.botRankX, corner.botRowY, cornerFont, true, weight);
  if (decoration === 'underline') {
    drawUnderline(ctx, color, corner.botSuitX, corner.botRowY - cornerFont * 0.32, w, true);
  }

  const cx = w / 2;
  const cy = h / 2;
  if (rank === 1) {
    const aceFont = Math.round(w * 0.58);
    drawGlyph(ctx, glyph, color, cx, cy + aceFont * 0.08, aceFont, false, weight);
  } else if (rank >= 2 && rank <= 10 && PIP_LAYOUTS[rank]) {
    const layout = PIP_LAYOUTS[rank];
    const pipSize = pipSizePx(w, rank);
    for (const p of layout) {
      const { x: px, y: py } = pipPoint(p.x, p.y, w, h);
      drawGlyph(ctx, glyph, color, px, py, pipSize, !!p.flip, weight);
    }
  } else {
    const faceFont = Math.round(w * 0.42);
    const glyphFont = Math.round(w * 0.52);
    drawGlyph(ctx, label, color, cx, cy - faceFont * 0.42, faceFont, false, weight);
    drawGlyph(ctx, glyph, color, cx, cy + glyphFont * 0.22, glyphFont, false, weight);
    if (decoration === 'underline') {
      drawUnderline(ctx, color, cx, cy + glyphFont * 0.22, glyphFont * 1.6, false);
    }
    if (rank >= 11) {
      ctx.save();
      ctx.globalAlpha = 0.08;
      drawGlyph(ctx, glyph, color, cx, cy + glyphFont * 0.22, Math.round(w * 0.85), false, weight);
      ctx.restore();
    }
  }
}

export function drawLargeValueCardFace(ctx, suit, rank, w, h, { colorFor = colorOf, background = '#fbfbf7', border = 'rgba(0,0,0,0.18)', weightFor, decorationFor } = {}) {
  const radius = Math.max(4, Math.round(w * 0.07));
  const color = colorFor(suit);
  const weight = weightFor ? weightFor(suit) : 700;
  const decoration = decorationFor ? decorationFor(suit) : null;
  const glyph = SUIT_GLYPH[suit];
  const label = rankLabel(rank);

  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.fillStyle = background;
  ctx.fill();
  ctx.save();
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.clip();
  const grad = ctx.createLinearGradient(0, 0, 0, h * 0.22);
  grad.addColorStop(0, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h * 0.22);
  const innerGrad = ctx.createLinearGradient(0, h * 0.78, 0, h);
  innerGrad.addColorStop(0, 'rgba(0,0,0,0)');
  innerGrad.addColorStop(1, 'rgba(0,0,0,0.07)');
  ctx.fillStyle = innerGrad;
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
  ctx.restore();
  ctx.lineWidth = Math.max(1, w * 0.012);
  ctx.strokeStyle = border;
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.stroke();
  ctx.save();
  roundRect(ctx, 1, 1, w - 2, h - 2, radius * 0.85);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(1, w * 0.01);
  ctx.stroke();
  ctx.restore();

  // Same side-by-side corner row as drawCardFace (shared layout helpers), so
  // the large-value deck keeps consistent corners next to its huge body value.
  const cornerFont = cornerFontPx(w);
  ctx.font = `${weight} ${cornerFont}px system-ui, sans-serif`;
  const corner = layoutCornerRow(w, h, ctx.measureText(label).width, ctx.measureText(glyph).width);
  drawGlyph(ctx, label, color, corner.rankX, corner.rowY, cornerFont, false, weight);
  drawGlyph(ctx, glyph, color, corner.suitX, corner.rowY, cornerFont, false, weight);
  if (decoration === 'underline') {
    drawUnderline(ctx, color, corner.suitX, corner.rowY + cornerFont * 0.32, w, false);
  }
  drawGlyph(ctx, glyph, color, corner.botSuitX, corner.botRowY, cornerFont, true, weight);
  drawGlyph(ctx, label, color, corner.botRankX, corner.botRowY, cornerFont, true, weight);
  if (decoration === 'underline') {
    drawUnderline(ctx, color, corner.botSuitX, corner.botRowY - cornerFont * 0.32, w, true);
  }

  const cx = w / 2;
  const cy = h / 2;
  const bigValueFont = Math.round(w * 0.52);
  drawGlyph(ctx, label, color, cx, cy, bigValueFont, false, weight);
}

/**
 * Draw a card back (repeating diagonal motif) into the given context, filling
 * the rectangle [0,0,w,h].
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 */
function drawBackPattern(ctx, w, h, pattern, baseColor) {
  ctx.save();
  roundRect(ctx, 0, 0, w, h, Math.max(4, Math.round(w * 0.07)));
  ctx.clip();
  if (pattern === 'diagonal') {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = Math.max(1, w * 0.04);
    const step = w * 0.28;
    for (let i = -h; i < w; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + h, h);
      ctx.stroke();
    }
  } else if (pattern === 'houndstooth') {
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    const s = w * 0.18;
    for (let y = -s; y < h + s; y += s) {
      for (let x = -s; x < w + s; x += s) {
        const odd = (Math.floor(x / s) + Math.floor(y / s)) % 2 === 0;
        if (odd) ctx.fillRect(x, y, s * 0.5, s * 0.5);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 0.7;
    for (let y = 0; y < h; y += s) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  } else if (pattern === 'damask') {
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    const r = w * 0.09;
    for (let y = r; y < h - r; y += r * 2.2) {
      for (let x = r; x < w - r; x += r * 2.2) {
        ctx.beginPath();
        ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - r * 0.32, y);
        ctx.lineTo(x + r * 0.32, y);
        ctx.moveTo(x, y - r * 0.32);
        ctx.lineTo(x, y + r * 0.32);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
  } else if (pattern === 'linen') {
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 0.6;
    for (let y = 0; y < h; y += 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let x = 0; x < w; x += 3) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 0.9;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  } else if (pattern === 'waves') {
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 1.1;
    for (let y = 8; y < h - 6; y += 14) {
      ctx.beginPath();
      for (let x = 0; x < w; x += 6) {
        const yy = y + Math.sin((x / w) * Math.PI * 4) * 3;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  } else if (pattern === 'hex') {
    ctx.strokeStyle = 'rgba(255,255,255,0.11)';
    ctx.lineWidth = 0.7;
    const hexR = w * 0.11;
    const hexH = hexR * Math.sqrt(3);
    for (let y = -hexH; y < h + hexH; y += hexH * 0.75) {
      for (let x = -hexR; x < w + hexR; x += hexR * 1.5) {
        const off = (Math.round(y / hexH) % 2) * hexR * 0.75;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          const px = x + off + Math.cos(a) * hexR * 0.55;
          const py = y + Math.sin(a) * hexR * 0.55;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

export function drawCardBack(ctx, w, h, { baseColor = '#2b3a67', pattern = 'diagonal' } = {}) {
  const radius = Math.max(4, Math.round(w * 0.07));

  roundRect(ctx, 0, 0, w, h, radius);
  ctx.fillStyle = baseColor;
  ctx.fill();
  const grad = ctx.createRadialGradient(w * 0.35, h * 0.25, w * 0.1, w * 0.5, h * 0.5, w * 0.9);
  grad.addColorStop(0, 'rgba(255,255,255,0.13)');
  grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.fill();

  drawBackPattern(ctx, w, h, pattern, baseColor);

  roundRect(ctx, w * 0.08, w * 0.08, w - w * 0.16, h - w * 0.16, radius * 0.7);
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = Math.max(1, w * 0.018);
  ctx.stroke();
  roundRect(ctx, w * 0.11, w * 0.11, w - w * 0.22, h - w * 0.22, radius * 0.55);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = Math.max(1, w * 0.012);
  ctx.stroke();
}
