// components/pileHoverOverlay.js
// Pure decision helper for the Hover Glow / Drop Highlight overlay rendered
// inside each Pile while a drag is hovering it. Extracted as a pure function
// (no React, no DOM) so the render condition has a single source of truth
// and can be exhaustively unit-tested under node --test without needing
// jsdom or @testing-library.
//
// Render contract:
//   The overlay is mounted ⇔ dnd-kit reports the pile as hovered (showHover)
//   AND the user has opted into the card-effects system (cardEffects)
//   AND the user has the hover-glow sub-style enabled (hoverGlow).
//
// Disabling hoverGlow (or cardEffects) must remove the overlay from the DOM
// entirely — never just swap to a different style. See AGENTS.md perf/memory
// invariant: disabling a visual toggle should really free its resources.

/**
 * @param {object} args
 * @param {boolean} args.showHover      dnd-kit isOver already filtered by
 *                                       stock/waste/empty-foundation rules
 * @param {boolean} args.cardEffects    master toggle from useSettingsStore
 * @param {boolean} args.hoverGlow      hover-glow sub-toggle from useSettingsStore
 * @returns {boolean}  true ⇔ the overlay <div> should be rendered
 */
export function shouldRenderPileHoverOverlay({ showHover, cardEffects, hoverGlow }) {
  return !!(showHover && cardEffects && hoverGlow);
}
