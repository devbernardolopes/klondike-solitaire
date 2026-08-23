/**
 * Centralized GSAP motion presets. Each entry maps to a distinct animation in
 * the game and is consumed by the animation layer (see useCardMoveSlide,
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
  // Card relocation tween for EVERY move except the stock→waste draw (that one is
  // handled separately by useStockDrawSlide). Driven by the explicit GSAP translate
  // in useCardMoveSlide. Covers single cards and multi-card runs between any piles:
  // waste↔foundation, tableau↔foundation, tableau↔tableau, foundation→tableau.
  // The tween follows the real old→new path, so it is naturally DIAGONAL whenever
  // the source and destination differ on both axes. A run lifts and lands as a
  // RIGID BLOCK because every card in it tweens in parallel (stagger 0) with the
  // grabbed/clicked card leading the move.
  move:     { duration: 0.20, ease: 'power3.out', stagger: 0.01 },

  // Auto-complete relocation tween (greedy foundation peel + solver win
  // sequence). Independent of `move` so it can be tuned (e.g. made snappier)
  // without affecting normal player moves. Consumed by useCardMoveSlide via
  // CONFIG_BY_TYPE.auto.
  auto:     { duration: 0.20, ease: 'power3.out', stagger: 0.01 },
  // Alternative easing for the same tween; swap to change the acceleration curve.
  // move:     { duration: 0.40, ease: 'power3.out', stagger: 0 },

  // Auto-complete step pacing (how the SEQUENCE of foundation-peel / solver-win
  // moves is timed relative to one another — distinct from the per-card
  // relocation tween above, which is MOTION.auto). `mode`:
  //   'sequential' — each card only STARTS moving after the previous one has
  //                  fully LANDED at its destination, then `stepDelay` ms elapse.
  //                  This is the original behaviour and avoids any two cards
  //                  being in flight at once.
  //   'overlap'    — the next card STARTS moving `stepDelay` ms after the
  //                  previous step BEGAN, so multiple cards can be airborne
  //                  simultaneously. The relocation tweens themselves still use
  //                  MOTION.auto; only the inter-step cadence changes.
  // `stepDelay` is milliseconds; clamped to 0..1000 when read. 0 = no gap (next
  // step starts immediately; in 'overlap' this gives maximum concurrency).
  autoComplete: { mode: 'overlap', stepDelay: 80 },

  // 3D rotateY face flip (face-down <-> face-up) in useCardFaceFlip.
  flipCard: { duration: 0.06, ease: 'power3.out' },

  // Stock → waste draw slide. The revealed card flips face-up in place at the
  // stock pile and THEN glides horizontally to the waste pile. The horizontal
  // direction is automatic: it follows the board layout, which already mirrors
  // with the Hand orientation (right-handed = waste left of stock → slide left;
  // left-handed = waste right of stock → slide right). So no explicit direction
  // field is needed — tweak the values below to change the glide.
  draw:     {
    duration: 0.06,         // length of the horizontal slide tween (seconds).
    ease: 'power3.out',
    // Extra horizontal travel (px) added beyond the natural pile-to-pile
    // distance to make the glide more pronounced. 0 keeps it a pure stock→waste
    // move; positive values start the card a bit further out from the stock.
    overshoot: 4,
  },

  // Initial deal animation; cards deal out one after another via the stagger.
  deal:     { duration: 0.15, stagger: 0.02, ease: 'power2.out' },

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
