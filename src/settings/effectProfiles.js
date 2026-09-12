// settings/effectProfiles.js
// Named effect presets for the Settings "Effect Profile" dropdown. Each
// profile is a full snapshot of the 18 effect keys it manages; Default is the
// baseline and the others are expressed as diffs on top of it. Profiles never
// touch handedness, sound, volume, centiseconds, or auto-complete — those
// stay exactly as the user left them.
//
// The module is UI-free (plain data + pure helpers) so it stays unit-testable
// in isolation like `core/`.

export const EFFECT_PROFILE_IDS = ['default', 'calm', 'essential', 'showcase'];
export const CUSTOM_PROFILE_ID = 'custom';

// The requested "Default" baseline: every key a profile manages.
export const DEFAULT_EFFECT_SNAPSHOT = {
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
};

export const EFFECT_PROFILE_KEYS = Object.keys(DEFAULT_EFFECT_SNAPSHOT);

export const EFFECT_PROFILES = {
  default: { ...DEFAULT_EFFECT_SNAPSHOT },
  calm: {
    ...DEFAULT_EFFECT_SNAPSHOT,
    particles: false,
    cardShake: false,
    coinFly: false,
    hoverLift: false,
    cardEffects: false,
    shimmer: false,
    hoverGlow: false,
    ghostTrail: false,
    tapRipple: false,
    pickupLift: false,
    dropSnap: false,
    winEnhanced: false,
    tableTexture: false,
  },
  essential: {
    ...DEFAULT_EFFECT_SNAPSHOT,
    particles: false,
    coinFly: false,
    hoverLift: false,
    hoverGlow: false,
    tapRipple: false,
    pickupLift: false,
    dropSnap: false,
    winEnhanced: false,
  },
  showcase: {
    ...DEFAULT_EFFECT_SNAPSHOT,
    highlightCard: true,
    flipOvershoot: true,
    bounce: true,
    uncover: true,
    ghostEcho: true,
    ghostTrail: true,
    wobble: true,
    tapRipple: true,
    pickupLift: true,
    dropSnap: true,
    winCascade: true,
    boardFrame: true,
  },
};

/**
 * Pick just the profile-managed keys out of a settings state object.
 * @param {object} state
 * @returns {object}
 */
export function snapshotOf(state) {
  const out = {};
  for (const k of EFFECT_PROFILE_KEYS) out[k] = !!state?.[k];
  return out;
}

/**
 * @param {object} state settings state (or snapshot)
 * @param {string} id a named profile id
 * @returns {boolean} true when every managed key matches the profile
 */
export function matchesProfile(state, id) {
  const profile = EFFECT_PROFILES[id];
  if (!profile) return false;
  for (const k of EFFECT_PROFILE_KEYS) {
    if (!!state?.[k] !== profile[k]) return false;
  }
  return true;
}

/**
 * @param {object} state settings state (or snapshot)
 * @returns {string} the matching named profile id, or 'custom' when none matches
 */
export function resolveProfileId(state) {
  for (const id of EFFECT_PROFILE_IDS) {
    if (matchesProfile(state, id)) return id;
  }
  return CUSTOM_PROFILE_ID;
}
