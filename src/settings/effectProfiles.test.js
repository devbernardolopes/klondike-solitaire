import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOM_PROFILE_ID,
  DEFAULT_EFFECT_SNAPSHOT,
  EFFECT_PROFILES,
  EFFECT_PROFILE_IDS,
  EFFECT_PROFILE_KEYS,
  matchesProfile,
  resolveProfileId,
  snapshotOf,
} from './effectProfiles.js';

test('all named profiles manage exactly the same key set', () => {
  for (const id of EFFECT_PROFILE_IDS) {
    assert.deepEqual(Object.keys(EFFECT_PROFILES[id]).sort(), [...EFFECT_PROFILE_KEYS].sort());
  }
});

test('default snapshot matches the requested baseline', () => {
  assert.deepEqual(DEFAULT_EFFECT_SNAPSHOT, {
    particles: true,
    cardShake: true,
    coinFly: true,
    hoverLift: true,
    cardEffects: true,
    shimmer: true,
    hoverGlow: true,
    ghostTrail: false,
    winEnhanced: true,
    tableTexture: true,
    highlightCard: false,
    flipOvershoot: false,
    bounce: false,
    uncover: false,
    ghostEcho: true,
    wobble: false,
    tapRipple: true,
    pickupLift: true,
    dropSnap: true,
    winCascade: false,
    boardFrame: false,
  });
});

test('calm disables exactly its thirteen keys against default', () => {
  const { calm } = EFFECT_PROFILES;
  for (const k of ['particles', 'cardShake', 'coinFly', 'hoverLift', 'cardEffects', 'shimmer', 'hoverGlow', 'ghostTrail', 'tapRipple', 'pickupLift', 'dropSnap', 'winEnhanced', 'tableTexture']) {
    assert.equal(calm[k], false);
  }
  for (const k of EFFECT_PROFILE_KEYS) {
    if (calm[k] !== false) assert.equal(calm[k], DEFAULT_EFFECT_SNAPSHOT[k]);
  }
});

test('essential disables exactly its eight keys against default', () => {
  const { essential } = EFFECT_PROFILES;
  for (const k of ['particles', 'coinFly', 'hoverLift', 'hoverGlow', 'tapRipple', 'pickupLift', 'dropSnap', 'winEnhanced']) {
    assert.equal(essential[k], false);
  }
  for (const k of EFFECT_PROFILE_KEYS) {
    if (essential[k] !== false) assert.equal(essential[k], DEFAULT_EFFECT_SNAPSHOT[k]);
  }
});

test('showcase enables exactly its twelve keys against default', () => {
  const { showcase } = EFFECT_PROFILES;
  for (const k of ['highlightCard', 'flipOvershoot', 'bounce', 'uncover', 'ghostEcho', 'ghostTrail', 'wobble', 'tapRipple', 'pickupLift', 'dropSnap', 'winCascade', 'boardFrame']) {
    assert.equal(showcase[k], true);
  }
  for (const k of EFFECT_PROFILE_KEYS) {
    if (showcase[k] !== true) assert.equal(showcase[k], DEFAULT_EFFECT_SNAPSHOT[k]);
  }
});

test('default and essential have ghost echo on and ghost trail off', () => {
  for (const id of ['default', 'essential']) {
    assert.equal(EFFECT_PROFILES[id].ghostEcho, true);
    assert.equal(EFFECT_PROFILES[id].ghostTrail, false);
  }
});

test('resolveProfileId round-trips every named profile', () => {
  for (const id of EFFECT_PROFILE_IDS) {
    assert.equal(resolveProfileId(EFFECT_PROFILES[id]), id);
    assert.equal(matchesProfile(EFFECT_PROFILES[id], id), true);
  }
});

test('a single flipped toggle resolves to custom', () => {
  const custom = { ...EFFECT_PROFILES.default, particles: false };
  assert.equal(resolveProfileId(custom), CUSTOM_PROFILE_ID);
  assert.equal(matchesProfile(custom, 'default'), false);
});

test('snapshotOf ignores non-managed keys like handedness and sound', () => {
  const state = { ...EFFECT_PROFILES.default, handedness: 'left', soundVolume: 0.2, autoComplete: false };
  assert.deepEqual(snapshotOf(state), EFFECT_PROFILES.default);
  assert.equal(resolveProfileId(state), 'default');
});
