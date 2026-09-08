// components/shouldWobble.js
// Pure decision helper for the "Wobbly Cards" idle effect. Centralizes the
// stillness eligibility so CardView render gating and the GSAP hook share a
// single source of truth, exhaustively unit-testable under node --test.
//
// Wobble applies ⇔ master cardEffects is on AND the wobble sub-toggle is on
// AND the card is a resting face-up tableau card AND nothing else owns its
// transform AND reduced motion is not requested. Hover only blocks when Hover
// Lift is enabled (per spec: a hovered card yields to the lift affordance).

/**
 * @param {object} args
 * @param {boolean} args.cardEffects master toggle from useSettingsStore
 * @param {boolean} args.wobble wobble sub-toggle from useSettingsStore
 * @param {boolean} args.faceUp card.faceUp
 * @param {boolean} args.isTableau true when `from` starts with 'tableau'
 * @param {boolean} [args.isAnimating] card in animatingCards (move/undo/draw flip)
 * @param {boolean} [args.isSliding] card in slidingCards (stock→waste slide)
 * @param {boolean} [args.isShaking] card in shakingCards (invalid-move shake)
 * @param {boolean} [args.isDragging] global dnd-kit drag in progress
 * @param {boolean} [args.isHovered] pointer currently over this card
 * @param {boolean} [args.hoverLiftOn] Hover Lift toggle (only then does hover block)
 * @param {boolean} [args.isHidden] hidden behind DragOverlay / filtered from pile
 * @param {boolean} [args.won] board already won (cascade owns transforms)
 * @param {boolean} [args.fullLock] win cascade / deal reset lock
 * @param {boolean} [args.reducedMotion] prefers-reduced-motion or OS reduce flag
 * @returns {boolean} true ⇔ the card may idle-wobble right now
 */
export function shouldWobble({
  cardEffects,
  wobble,
  faceUp,
  isTableau,
  isAnimating = false,
  isSliding = false,
  isShaking = false,
  isDragging = false,
  isHovered = false,
  hoverLiftOn = false,
  isHidden = false,
  won = false,
  fullLock = false,
  reducedMotion = false,
}) {
  if (!cardEffects || !wobble) return false;
  if (!faceUp || !isTableau) return false;
  if (reducedMotion || won || fullLock || isHidden) return false;
  if (isAnimating || isSliding || isShaking || isDragging) return false;
  if (hoverLiftOn && isHovered) return false;
  return true;
}
