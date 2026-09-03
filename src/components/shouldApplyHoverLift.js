// components/shouldApplyHoverLift.js
// Pure decision helper for the `data-hover-lift="on"` attribute set on
// <html> by App.jsx when the user has the Hover Lift effect enabled. The
// attribute gates the CSS rules in classic.css / dark.css that translate
// and brighten a card on `:hover`. Extracted as a pure function so the
// render condition has a single source of truth and can be exhaustively
// unit-tested under node --test without needing jsdom.
//
// Render contract:
//   The data-hover-lift attribute is set ⇔ cardEffects is on AND hoverLift
//   is on. Disabling either removes the attribute entirely so the CSS
//   :hover rise (and the :active depress) cannot fire. See AGENTS.md
//   perf/memory invariant: disabling a visual toggle should really free
//   its resources.

/**
 * @param {object} args
 * @param {boolean} args.cardEffects  master toggle from useSettingsStore
 * @param {boolean} args.hoverLift    hover-lift sub-toggle from useSettingsStore
 * @returns {boolean}  true ⇔ the data-hover-lift="on" attribute should be set
 */
export function shouldApplyHoverLift({ cardEffects, hoverLift }) {
  return !!(cardEffects && hoverLift);
}
