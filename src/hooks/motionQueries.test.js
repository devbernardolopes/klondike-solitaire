import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { isReducedMotion } from './useReducedMotion.js';
import { isHoverCapable } from './useHoverCapable.js';

const OriginalWindow = globalThis.window;

afterEach(() => {
  if (OriginalWindow === undefined) delete globalThis.window;
  else globalThis.window = OriginalWindow;
});

test('isReducedMotion is false without a window', () => {
  delete globalThis.window;
  assert.equal(isReducedMotion(), false);
});

test('isReducedMotion mirrors the media query', () => {
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  assert.equal(isReducedMotion(), true);
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  assert.equal(isReducedMotion(), false);
});

test('isReducedMotion is false when matchMedia throws', () => {
  globalThis.window = { matchMedia: () => { throw new Error('nope'); } };
  assert.equal(isReducedMotion(), false);
});

test('isHoverCapable defaults to true without a window', () => {
  delete globalThis.window;
  assert.equal(isHoverCapable(), true);
});

test('isHoverCapable mirrors the media query', () => {
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  assert.equal(isHoverCapable(), true);
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  assert.equal(isHoverCapable(), false);
});
