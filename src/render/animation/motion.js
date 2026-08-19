/**
 * Centralized GSAP motion presets. Each entry maps to a distinct animation in
 * the game and is consumed by the animation layer (see useCardMoveFlip,
 * useCardFaceFlip, winCascade, playCardShake). Units are seconds for time-like
 * properties and CSS pixels for distance-like ones.
 *
 * Shared property meanings:
 *   duration  - Length of the tween in seconds.
 *   ease      - GSAP easing function name controlling the acceleration curve
 *               (e.g. 'power1.in' starts slow, 'power2.out' decelerates).
 *   stagger   - Delay in seconds inserted between elements so a group animates
 *               in sequence rather than all at once.
 */
export const MOTION = {
  // Card relocation tween (draw, auto-move, and generic moves), driven through
  // the GSAP Flip pipeline in useCardMoveFlip. Snappy, clearly-visible glide
  // (short duration + decelerating ease) so cards read as flying to their
  // destination rather than snapping.
  move:     { duration: 0.40, ease: 'power2.out' },
  // Alternative easing choice for the same move tween; swap with the line above
  // to change the move's acceleration curve (power3.out decelerates harder).
  // move:     { duration: 0.40, ease: 'power3.out' },

  // 3D rotateY face flip (face-down <-> face-up) in useCardFaceFlip.
  flipCard: { duration: 0.22, ease: 'power2.inOut' },

  // Stock → waste draw slide. The revealed card flips face-up in place at the
  // stock pile and THEN glides horizontally to the waste pile. The horizontal
  // direction is automatic: it follows the board layout, which already mirrors
  // with the Hand orientation (right-handed = waste left of stock → slide left;
  // left-handed = waste right of stock → slide right). So no explicit direction
  // field is needed — tweak the values below to change the glide.
  draw:     {
    duration: 0.10,         // length of the horizontal slide tween (seconds).
    ease: 'power2.out',     // decelerating glide into the waste pile.
    // Extra horizontal travel (px) added beyond the natural pile-to-pile
    // distance to make the glide more pronounced. 0 keeps it a pure stock→waste
    // move; positive values start the card a bit further out from the stock.
    overshoot: 0,
  },

  // Initial deal animation; cards deal out one after another via the stagger.
  deal:     { duration: 0.32, stagger: 0.045, ease: 'power2.out' },

  // Victory cascade: every card flies off toward the bottom of the screen.
  win:      {
    duration: 0.5,         // per-card fly-off tween length.
    stagger: 0.06,         // per-card delay; winCascade applies from: 'end' so the
                           // top card of each pile leads the cascade.
    ease: 'power1.in',     // accelerates as the card falls away.
    flyDistance: 900,      // maximum pixels a card may travel downward before
                           // being clamped to stay on screen (winCascade:74).
    bottomMargin: 64,      // reserved bottom gap so cards don't leave the
                           // viewport; subtracted when computing fall distance
                           // (winCascade:35,73).
  },

  // Invalid-move shake (playCardShake). The sub-steps are fractions of
  // `duration`, and `distance` is the horizontal shift on each side.
  shake:    { duration: 0.25, distance: 8 },
};
