import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldApplyHoverLift } from './shouldApplyHoverLift.js';

test('shouldApplyHoverLift: hoverLift OFF removes the hover-rise (regression for "Card Bounce gates hover-rise" bug)', () => {
  // The reported bug: disabling Card Bounce also removed the CSS hover-rise
  // because the rise was coupled via a single data-bounce attribute. With
  // hoverLift as its own toggle, disabling it must remove the attribute
  // even if Card Bounce is on.
  assert.equal(
    shouldApplyHoverLift({ cardEffects: true, hoverLift: false }),
    false,
    'hoverLift=false must NOT apply the data-hover-lift attribute, even when cardEffects=true'
  );
});

test('shouldApplyHoverLift: cardEffects OFF removes the attribute even if hoverLift is ON', () => {
  // Defensive: cardEffects is the master toggle, so its off-state must win
  // even if a stale store / future programmatic setter has hoverLift=true.
  assert.equal(
    shouldApplyHoverLift({ cardEffects: false, hoverLift: true }),
    false
  );
});

test('shouldApplyHoverLift: full truth table — only the all-true combination applies', () => {
  const cases = [
    { cardEffects: false, hoverLift: false, expected: false },
    { cardEffects: false, hoverLift: true,  expected: false },
    { cardEffects: true,  hoverLift: false, expected: false },
    { cardEffects: true,  hoverLift: true,  expected: true  },
  ];
  for (const { expected, ...args } of cases) {
    const got = shouldApplyHoverLift(args);
    assert.equal(
      got,
      expected,
      `shouldApplyHoverLift(${JSON.stringify(args)}) should return ${expected}, got ${got}`
    );
  }
});

test('shouldApplyHoverLift: coerces non-boolean truthy/falsy inputs safely', () => {
  // The implementation uses !!() so undefined / null / 0 / '' / 'yes' all
  // collapse to a real boolean. This is a defensive contract for callers
  // that may pass through a selector returning undefined.
  assert.equal(shouldApplyHoverLift({ cardEffects: 1, hoverLift: 'yes' }), true);
  assert.equal(shouldApplyHoverLift({ cardEffects: 0, hoverLift: true }), false);
  assert.equal(shouldApplyHoverLift({ cardEffects: true, hoverLift: undefined }), false);
  assert.equal(shouldApplyHoverLift({ cardEffects: null, hoverLift: true }), false);
});
