import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRenderPileHoverOverlay } from './pileHoverOverlay.js';

test('pileHoverOverlay: hoverGlow OFF removes the overlay (regression for "setting does nothing" bug)', () => {
  // The reported bug: with hoverGlow=false, the overlay still rendered (just
  // with a different border style). The fix unmounts it entirely.
  assert.equal(
    shouldRenderPileHoverOverlay({ showHover: true, cardEffects: true, hoverGlow: false }),
    false,
    'hoverGlow=false must NOT render the overlay, even when cardEffects=true and dnd-kit is over the pile'
  );
});

test('pileHoverOverlay: cardEffects OFF removes the overlay even if hoverGlow is ON', () => {
  // Defensive: cardEffects is the master toggle, so its off-state must win
  // even if a stale store / future programmatic setter has hoverGlow=true.
  assert.equal(
    shouldRenderPileHoverOverlay({ showHover: true, cardEffects: false, hoverGlow: true }),
    false
  );
});

test('pileHoverOverlay: not hovered (showHover=false) never renders', () => {
  assert.equal(
    shouldRenderPileHoverOverlay({ showHover: false, cardEffects: true, hoverGlow: true }),
    false
  );
});

test('pileHoverOverlay: full truth table — only the all-true combination renders', () => {
  // Exhaustively enumerates the 8 combinations of {showHover, cardEffects, hoverGlow}.
  // The helper is a 3-input AND, so only the (1,1,1) row should return true.
  const cases = [
    { showHover: false, cardEffects: false, hoverGlow: false, expected: false },
    { showHover: false, cardEffects: false, hoverGlow: true,  expected: false },
    { showHover: false, cardEffects: true,  hoverGlow: false, expected: false },
    { showHover: false, cardEffects: true,  hoverGlow: true,  expected: false },
    { showHover: true,  cardEffects: false, hoverGlow: false, expected: false },
    { showHover: true,  cardEffects: false, hoverGlow: true,  expected: false },
    { showHover: true,  cardEffects: true,  hoverGlow: false, expected: false },
    { showHover: true,  cardEffects: true,  hoverGlow: true,  expected: true  },
  ];
  for (const { expected, ...args } of cases) {
    const got = shouldRenderPileHoverOverlay(args);
    assert.equal(
      got,
      expected,
      `shouldRenderPileHoverOverlay(${JSON.stringify(args)}) should return ${expected}, got ${got}`
    );
  }
});

test('pileHoverOverlay: coerces non-boolean truthy/falsy inputs safely', () => {
  // The implementation uses !!() so undefined / null / 0 / '' / 'yes' all
  // collapse to a real boolean. This is a defensive contract for callers
  // that may pass through a selector returning undefined.
  assert.equal(shouldRenderPileHoverOverlay({ showHover: 1, cardEffects: 'yes', hoverGlow: {} }), true);
  assert.equal(shouldRenderPileHoverOverlay({ showHover: 0, cardEffects: true, hoverGlow: true }), false);
  assert.equal(shouldRenderPileHoverOverlay({ showHover: undefined, cardEffects: true, hoverGlow: true }), false);
  assert.equal(shouldRenderPileHoverOverlay({ showHover: true, cardEffects: null, hoverGlow: true }), false);
});
