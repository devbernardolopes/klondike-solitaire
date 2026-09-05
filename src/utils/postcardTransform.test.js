import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  POSTCARD_MIN_SCALE,
  POSTCARD_MAX_SCALE,
  clampScale,
  normalizeWheelDelta,
  applyWheelZoom,
  applyPinchZoom,
  pinchDistance,
  pinchMidpoint,
  fitSize,
  clampPan,
  isDoubleTap,
} from './postcardTransform.js';

test('clampScale bounds and non-finite input', () => {
  assert.equal(clampScale(1), 1);
  assert.equal(clampScale(0.1), POSTCARD_MIN_SCALE);
  assert.equal(clampScale(99), POSTCARD_MAX_SCALE);
  assert.equal(clampScale(NaN), 1);
  assert.equal(clampScale(Infinity), 1);
});

test('normalizeWheelDelta handles delta modes', () => {
  assert.equal(normalizeWheelDelta(100, 0), 100);
  assert.equal(normalizeWheelDelta(3, 1), 48);
  assert.equal(normalizeWheelDelta(1, 2), 800);
  assert.equal(normalizeWheelDelta(0, 0), 0);
});

test('wheel zoom in/out direction and centered invariance', () => {
  const view = { scale: 1, tx: 30, ty: -20 };
  const zoomedIn = applyWheelZoom(view, -100, 0);
  assert.ok(zoomedIn.scale > 1);
  // Centered zoom: translation untouched, image never shifts position.
  assert.equal(zoomedIn.tx, 30);
  assert.equal(zoomedIn.ty, -20);
  const zoomedOut = applyWheelZoom(view, 100, 0);
  assert.ok(zoomedOut.scale < 1);
  assert.equal(zoomedOut.tx, 30);
  assert.equal(zoomedOut.ty, -20);
  assert.equal(applyWheelZoom(view, 0, 0), view);
});

test('wheel zoom clamps at the range ends', () => {
  assert.equal(applyWheelZoom({ scale: 1, tx: 0, ty: 0 }, -100000, 0).scale, POSTCARD_MAX_SCALE);
  assert.equal(applyWheelZoom({ scale: 1, tx: 0, ty: 0 }, 100000, 0).scale, POSTCARD_MIN_SCALE);
});

test('pinch zoom follows the distance ratio', () => {
  const out = applyPinchZoom({ scale: 1, tx: 0, ty: 0 }, 100, 200);
  assert.equal(out.scale, 2);
  const back = applyPinchZoom(out, 200, 100);
  assert.equal(back.scale, 1);
  const bad = { scale: 1, tx: 0, ty: 0 };
  assert.equal(applyPinchZoom(bad, 0, 100), bad);
  assert.equal(applyPinchZoom(bad, 100, 0), bad);
});

test('pinchDistance and pinchMidpoint', () => {
  assert.equal(pinchDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.deepEqual(pinchMidpoint({ x: 0, y: 0 }, { x: 10, y: 20 }), { x: 5, y: 10 });
});

test('fitSize contains the image in the viewport', () => {
  // Wide image in a square viewport: width-bound.
  assert.deepEqual(fitSize(1600, 900, 400, 400, 16), { width: 368, height: 207 });
  // Tall image: height-bound.
  const tall = fitSize(900, 1600, 400, 400, 16);
  assert.ok(Math.abs(tall.width - 207) < 1e-9);
  assert.equal(tall.height, 368);
  assert.equal(fitSize(0, 900, 400, 400), null);
  assert.equal(fitSize(900, 900, 0, 400), null);
});

test('clampPan keeps the image recoverable', () => {
  // 368x207 image at 1x in a 400x400 viewport: small drift allowed.
  const small = clampPan(1000, 1000, 368, 207, 1, 400, 400);
  assert.ok(small.tx < 1000 && small.ty < 1000);
  assert.ok(small.tx >= 0 && small.ty >= 0);
  // Centered view is never clamped away.
  assert.deepEqual(clampPan(0, 0, 368, 207, 1, 400, 400), { tx: 0, ty: 0 });
  // Zoomed 4x: generous pan range survives clamping.
  const zoomed = clampPan(200, 100, 368, 207, 4, 400, 400);
  assert.equal(zoomed.tx, 200);
  assert.equal(zoomed.ty, 100);
});

test('isDoubleTap timing and distance windows', () => {
  const first = { t: 1000, x: 50, y: 50 };
  assert.equal(isDoubleTap(first, { t: 1200, x: 52, y: 51 }), true);
  assert.equal(isDoubleTap(first, { t: 1400, x: 50, y: 50 }), false);
  assert.equal(isDoubleTap(first, { t: 1200, x: 200, y: 50 }), false);
  assert.equal(isDoubleTap(null, { t: 1200, x: 50, y: 50 }), false);
  assert.equal(isDoubleTap(first, null), false);
});
