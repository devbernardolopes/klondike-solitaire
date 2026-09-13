// render/deck/cardLayout.test.js
// Numeric layout-invariant tests for the card-face geometry in drawCard.js.
// Canvas art can't be pixel-tested under plain `node --test`, but the layout
// math is pure: these tests lock the corner-row/pip-field relationship across
// all 13 ranks × 4 suits at both the renderer canvas size (96×134) and the
// Device-B CSS size (48×67.2), so a future ratio tweak can't silently push
// corners off-card or into the pips.
//
// Text widths are modeled conservatively (0.62em per rank char, 1.0em for the
// suit glyph — at or above real system-ui metrics), so passing here means
// passing with real measureText values too.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_LAYOUT,
  PIP_LAYOUTS,
  SUIT_GLYPH,
  cornerFontPx,
  layoutCornerRow,
  pipPoint,
  pipSizePx,
  rankLabel,
} from './drawCard.js';

const SUITS = Object.keys(SUIT_GLYPH);
// [w, h] pairs: baked renderer canvas, and Device-B CSS px.
const SIZES = [[96, 134], [48, 67.2]];

/** Conservative modeled width of a corner-row string at the corner font. */
function modeledWidth(text, fontPx) {
  return text.length * 0.62 * fontPx;
}

function suitWidth(fontPx) {
  return 1.0 * fontPx;
}

for (const [w, h] of SIZES) {
  test(`corner row stays on-card at ${w}x${h}`, () => {
    const fontPx = cornerFontPx(w);
    for (let rank = 1; rank <= 13; rank++) {
      const label = rankLabel(rank);
      const rankW = modeledWidth(label, fontPx);
      for (const suit of SUITS) {
        const row = layoutCornerRow(w, h, rankW, suitWidth(fontPx));
        assert.ok(row.left >= 0, `rank ${rank}/${suit}: left ${row.left}`);
        assert.ok(row.right <= w, `rank ${rank}/${suit}: right ${row.right} > ${w}`);
        assert.ok(row.top >= 0, `rank ${rank}/${suit}: top ${row.top}`);
        assert.ok(row.bottom <= h * 0.25, `rank ${rank}/${suit}: bottom ${row.bottom}`);
        // Bottom mirror stays on-card and mirrors the top row exactly.
        assert.equal(row.botRankX, w - row.rankX);
        assert.equal(row.botSuitX, w - row.suitX);
        assert.equal(row.botRowY, h - row.rowY);
        assert.ok(row.botRowY + fontPx / 2 <= h, `rank ${rank}/${suit}: mirror overflows`);
        assert.ok(row.botRowY - fontPx / 2 >= h * 0.75, `rank ${rank}/${suit}: mirror too high`);
      }
    }
  });

  test(`corner row clears the pip field at ${w}x${h}`, () => {
    const fontPx = cornerFontPx(w);
    const fieldTop = h * CARD_LAYOUT.pipTopRatio;
    const fieldBottom = h * (CARD_LAYOUT.pipTopRatio + CARD_LAYOUT.pipHeightRatio);
    for (let rank = 1; rank <= 13; rank++) {
      const row = layoutCornerRow(w, h, modeledWidth(rankLabel(rank), fontPx), suitWidth(fontPx));
      const topClear = fieldTop - row.bottom;
      const botClear = row.botRowY - fontPx / 2 - fieldBottom;
      assert.ok(topClear >= 0.02 * h, `rank ${rank}: top clearance ${topClear}`);
      assert.ok(botClear >= 0.02 * h, `rank ${rank}: bottom clearance ${botClear}`);
    }
  });

  test(`pip points land inside the card at ${w}x${h}`, () => {
    for (let rank = 2; rank <= 10; rank++) {
      for (const p of PIP_LAYOUTS[rank]) {
        const { x, y } = pipPoint(p.x, p.y, w, h);
        assert.ok(x >= 0 && x <= w, `rank ${rank}: x ${x}`);
        assert.ok(y >= 0 && y <= h, `rank ${rank}: y ${y}`);
      }
    }
  });

  test(`pip rows keep air between them at ${w}x${h}`, () => {
    // Adjacent pip-row centers must stay ≥0.06h apart (actual ≈0.083h). This
    // documents the kiss-by-design density of rank 7-10 and guards future
    // pip-field compression from stacking rows onto each other.
    for (let rank = 2; rank <= 10; rank++) {
      const rows = [...new Set(PIP_LAYOUTS[rank].map((p) => pipPoint(p.x, p.y, w, h).y))].sort(
        (a, b) => a - b,
      );
      for (let i = 1; i < rows.length; i++) {
        assert.ok(rows[i] - rows[i - 1] >= 0.06 * h, `rank ${rank}: row gap ${rows[i] - rows[i - 1]}`);
      }
      void pipSizePx(w, rank);
    }
  });
}

test('widest corner (10 + suit) fits with air to spare', () => {
  const w = 96;
  const h = 134;
  const fontPx = cornerFontPx(w);
  const row = layoutCornerRow(w, h, modeledWidth('10', fontPx), suitWidth(fontPx));
  assert.ok(row.right <= w * 0.6, `widest corner ends at ${row.right} of ${w}`);
  assert.ok(row.left >= 0, 'widest corner starts on-card');
});
