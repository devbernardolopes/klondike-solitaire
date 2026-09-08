import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldWobble } from './shouldWobble.js';

const base = {
  cardEffects: true,
  wobble: true,
  faceUp: true,
  isTableau: true,
};

test('shouldWobble: resting face-up tableau card wobbles', () => {
  assert.equal(shouldWobble({ ...base }), true);
});

test('shouldWobble: master toggles gate the effect', () => {
  assert.equal(shouldWobble({ ...base, cardEffects: false }), false);
  assert.equal(shouldWobble({ ...base, wobble: false }), false);
});

test('shouldWobble: only face-up tableau cards wobble', () => {
  assert.equal(shouldWobble({ ...base, faceUp: false }), false);
  assert.equal(shouldWobble({ ...base, isTableau: false }), false);
});

test('shouldWobble: motion/transform owners block wobble', () => {
  for (const flag of ['isAnimating', 'isSliding', 'isShaking', 'isDragging', 'isHidden', 'won', 'fullLock', 'reducedMotion']) {
    assert.equal(
      shouldWobble({ ...base, [flag]: true }),
      false,
      `${flag} must block wobble`,
    );
  }
});

test('shouldWobble: hover blocks only when Hover Lift is on', () => {
  assert.equal(shouldWobble({ ...base, isHovered: true, hoverLiftOn: true }), false);
  assert.equal(shouldWobble({ ...base, isHovered: true, hoverLiftOn: false }), true);
  assert.equal(shouldWobble({ ...base, isHovered: false, hoverLiftOn: true }), true);
});
