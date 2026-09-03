import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBounceSteps } from './useCardMoveSlideBounce.js';

const cfg = { duration: 0.2, ease: 'power3.out', stagger: 0 };
const bounceCfg = {
  duration: 0.2,
  ease: 'back.out(0.6)',
  scale: 1.03,
  rotation: 0.0,
  boxShadow: '0 6px 16px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.22)',
};

test('buildBounceSteps: returns empty array when shouldBounce is false', () => {
  assert.deepEqual(buildBounceSteps({ cfg, bounceCfg, shouldBounce: false }), []);
});

test('buildBounceSteps: returns empty array when bounceCfg is missing', () => {
  assert.deepEqual(buildBounceSteps({ cfg, bounceCfg: null, shouldBounce: true }), []);
  assert.deepEqual(buildBounceSteps({ cfg, bounceCfg: undefined, shouldBounce: true }), []);
});

test('buildBounceSteps: returns empty array when cfg is missing or has no duration', () => {
  assert.deepEqual(buildBounceSteps({ cfg: null, bounceCfg, shouldBounce: true }), []);
  assert.deepEqual(buildBounceSteps({ cfg: {}, bounceCfg, shouldBounce: true }), []);
});

test('buildBounceSteps: returns exactly two steps when bounce is enabled', () => {
  const steps = buildBounceSteps({ cfg, bounceCfg, shouldBounce: true });
  assert.equal(steps.length, 2, 'expected 2 steps (snap + settle)');
});

test('buildBounceSteps: snap step is duration 0 and positioned at cfg.duration (regression: must NOT be at 0)', () => {
  const steps = buildBounceSteps({ cfg, bounceCfg, shouldBounce: true });
  const [snap] = steps;
  assert.equal(snap.duration, 0, 'snap step must be duration 0');
  assert.equal(
    snap.position,
    cfg.duration,
    'snap step must be positioned at the END of the slide, not at the start'
  );
  assert.equal(snap.ease, 'none');
  assert.equal(snap.props.scale, bounceCfg.scale);
  assert.equal(snap.props.boxShadow, bounceCfg.boxShadow);
  assert.equal(snap.props.rotationZ, 0, 'rotationZ must be 0 (the random rotation is gone)');
});

test('buildBounceSteps: settle step is positioned at cfg.duration and uses bounceCfg.duration/ease', () => {
  const steps = buildBounceSteps({ cfg, bounceCfg, shouldBounce: true });
  const [, settle] = steps;
  assert.equal(settle.duration, bounceCfg.duration);
  assert.equal(
    settle.position,
    cfg.duration,
    'settle step must start at the same position as the snap (back-to-back at landing)'
  );
  assert.equal(settle.ease, bounceCfg.ease);
  assert.equal(settle.props.scale, 1, 'settle must end at scale 1');
  assert.equal(settle.props.rotationZ, 0);
});

test('buildBounceSteps: never positions bounce steps at t=0 (regression for "bounce runs concurrent with slide" bug)', () => {
  // The reported bug: bounce tween was positioned at `, 0` (concurrent with
  // the slide) so the card inflated and rotated mid-flight. This test
  // guards that regression at the helper layer.
  const steps = buildBounceSteps({ cfg, bounceCfg, shouldBounce: true });
  for (const step of steps) {
    assert.notEqual(
      step.position,
      0,
      `bounce step must not be positioned at t=0 (concurrent with slide): ${JSON.stringify(step)}`
    );
  }
});

test('buildBounceSteps: applies bounceCfg overrides with fallbacks', () => {
  const partial = { duration: 0.15 };
  const steps = buildBounceSteps({ cfg, bounceCfg: partial, shouldBounce: true });
  const [snap, settle] = steps;
  assert.equal(settle.duration, partial.duration);
  assert.equal(settle.ease, 'back.out(0.6)', 'ease falls back to back.out(0.6) when not provided');
  assert.equal(snap.props.scale, 1.03, 'scale falls back to 1.03 when not provided');
  assert.equal(
    snap.props.boxShadow,
    '0 6px 16px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.22)',
    'boxShadow falls back when not provided'
  );
});
