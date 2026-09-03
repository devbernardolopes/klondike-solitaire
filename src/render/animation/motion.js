/**
 * Centralized GSAP motion presets. Single source of truth for every tween in
 * the game. Import MOTION and read cfg.duration / ease / stagger etc. directly —
 * never hard-code timing inside useCardMoveSlide, winCascade, etc.
 *
 * Units:
 *   duration / stagger — seconds
 *   autoComplete.stepDelay — milliseconds (0..1000)
 *   radius / size / distance / overshoot / flyDistance / bottomMargin / blur / y — CSS pixels
 *   spin — degrees
 *   count / scale / alpha / maxConcurrent — unitless
 *   mode — enum ('sequential' | 'overlap')
 *
 * Ease reference:
 *   Power family (power1-power4):
 *     power1.* - Linear-like with subtle acceleration/deceleration, smooth UI transitions
 *     power2.* - Standard easing used for most UI animations, natural feel
 *     power3.* - Strong acceleration/deceleration, more dramatic motion
 *     power4.* - Extreme curves, very dramatic effects
 *
 *     power*.in    - Accelerate (slow start, fast end), enters scene with energy
 *     power*.out   - Decelerate (fast start, slow end), exits naturally
 *     power*.inOut - Both (slow start, fast middle, slow end), symmetrical motion
 *
 *   Back family:
 *     back.in(n)   - Overshoots backward then snaps forward (n=tension, 0.6-1.7)
 *     back.out(n)  - Overshoots forward then springs back (n=tension, commonly 0.4-1.7)
 *     back.inOut(n) - Overshoots both ways, symmetrical spring-back motion
 *     n (tension): 0.6 = subtle pop, 1.0 = moderate, 1.2+ = strong bounce
 *
 *   Sine family:
 *     sine.in   - Smooth sine wave acceleration, organic feel
 *     sine.out  - Smooth sine wave deceleration
 *     sine.inOut - Symmetrical sine curve, gentle motion
 *
 *   Circ family (circular motion):
 *     circ.in   - Circular entry, starts with small radius expanding
 *     circ.out  - Circular exit, ends with circular path completion
 *     circ.inOut - Circular entry and exit, symmetrical motion
 *
 *   Elastic family (spring-like bounce):
 *     elastic.in   - Bounces backward before snapping forward
 *     elastic.out  - Bounces forward then returns
 *     elastic.inOut - Bounces both ways
 *     Note: Can take additional parameters for bounce intensity and frequency
 *
 *   Bounce family:
 *     bounce.in   - Bounces on entry, multiple decreasing bounces
 *     bounce.out  - Bounces on exit, culminates in settling
 *     bounce.inOut - Bounces on both entry and exit
 *
 *   Special values:
 *     linear   - Constant velocity, no acceleration
 *     CubicBezier(customPoints...) - Custom ease curve defined by control points
 *     Stepper(steps) - Step animation for discrete transitions
 *     RoughEase(config) - Organic, uneven motion
 *
 *   Common GSAP ease formats:
 *     easeString               - 'power2.out', 'back.out(0.6)'
 *     Ease object             - new Power2.easeOut
 *     Function                - (t) => return eased value
 *
 *
 * Shared keys:
 *   duration — length of tween (s)
 *   ease — GSAP ease name or function
 *   stagger — delay between members of a group (s)
 */
export const MOTION = {
  // Card relocation for EVERY move except stock→waste draw (handled by useStockDrawSlide).
  // Explicit GSAP translate in useCardMoveSlide (oldRect → newRect). Naturally
  // diagonal; a multi-card run lands as RIGID BLOCK (stagger 0). Do not use
  // back/bounce/elastic here — stagger+overlap would make multiple cards bounce
  // on top of each other. Keep ease decelerating (power*.out / sine.out).
  move:     { duration: 0.20, ease: 'power3.out', stagger: 0.00 },

  // Auto-complete relocation (greedy foundation peel + solver win sequence).
  // Independent of `move` so it can be tuned snappier without touching manual
  // tap. Consumed via CONFIG_BY_TYPE.auto in useCardMoveSlide.
  auto:     { duration: 0.20, ease: 'power3.out', stagger: 0.01 },

  // Waste → stock recycle relocation.
  recycle:  { duration: 0.15, ease: 'power4.out', stagger: 0.00 },

  // Undo relocation. Same path as `move` (cards glide back), separate preset
  // so undo can feel quicker without changing tap feel. Consumed via CONFIG_BY_TYPE.undo.
  undo:     { duration: 0.20, ease: 'power3.out', stagger: 0.01 },

  // Auto-complete step pacing (SEQUENCE cadence, not per-card tween which is MOTION.auto).
  //   'sequential' — next card starts after previous LANDED + stepDelay ms (no concurrency)
  //   'overlap'    — next card starts stepDelay ms after previous BEGAN (airborne overlap)
  // stepDelay: milliseconds, clamped 0..1000. 0 = immediate.
  autoComplete: { mode: 'overlap', stepDelay: 50 },

  // 3D rotateY face flip (face-down ↔ face-up) in useCardFaceFlip. Subtle
  // back.out(0.6) gives a tiny overshoot pop; duration must be readable
  // (not 0.05 twitch). Keep under 0.22 so tableau reveals stay snappy.
  flipCard: { duration: 0.10, ease: 'back.out(0.4)' },

  // Stock → waste draw slide. Card flips in place at stock then glides
  // horizontally to waste. Direction mirrors Hand (right→slide left, left→slide right)
  // automatically via layout; no direction field needed.
  draw:     {
    duration: 0.05,         // horizontal slide (s)
    ease: 'power3.out',
    overshoot: 6,           // extra px beyond natural pile-to-pile distance
  },

  // Initial deal: cards fan out one after another via stagger.
  deal:     { duration: 0.35, stagger: 0.01, ease: 'power2.out' },

  // Victory cascade — falling cards. Gated by `winCascade` only,
  // independent of `cardEffects` and `winEnhanced` (confetti).
  win:      {
    duration: 0.5,         // per-card fly-off (s)
    stagger: 0.06,         // from:'end' so King peels first
    ease: 'power1.in',     // accelerates downward
    flyDistance: 900,      // max px clamped to viewport
    bottomMargin: 64,      // reserved bottom gap
  },

  // Invalid-move shake. Sub-steps are fractions of duration; distance is px.
  shake:    { duration: 0.25, distance: 8 },

  // Tableau uncover sparkle: star burst when face-down flips face-up via reveal.
  uncover: {
    count: 10,
    radius: 55,
    size: 18,
    duration: 1.0,
    ease: 'power2.out',
    spin: 70,
  },

  // Card flip shimmer: specular sweep after flip lands. Keep glint brief
  // so it reads as highlight, not linger.
  shimmer: { duration: 0.50, ease: 'power2.inOut' },

  // Pile hover glow: aura on valid drop targets (CSS keyframes pileGlow).
  // Consumed as inline animation duration in Pile.jsx; blur is shadow spread (px).
  hoverGlow: { duration: 1.1, blur: 14 },

  // Hover lift for premium cards (y px, scale, duration s). Currently CSS :hover
  // in classic.css; kept here so MotionDebugPanel can tune. Wire to JS if needed.
  hoverLift: { y: -4, scale: 1.02, duration: 0.15, ease: 'power2.out' },

  // Landing bounce on move/auto (single-card only). Independent of `move` slide
  // so translation stays power3.out while bounce alone may use back.out subtle
  // pop. Gated by cardEffects && bounce && !prefers-reduced-motion.
  bounce: { duration: 0.20, ease: 'back.out(0.6)', scale: 1.06, rotation: 0.8, y: -6, boxShadow: '0 14px 32px rgba(0,0,0,0.45), 0 5px 12px rgba(0,0,0,0.35)' },

  // Ghost echo left at the source position on every move/auto/undo. A single
  // cloned node parked at oldRect fades and shrinks in place. Capped to
  // maxConcurrent to avoid DOM flood during overlap auto.
  ghostEcho: { duration: 0.50, ease: 'power1.out', alpha: 1.0, scale: 0.96, maxConcurrent: 8 },

  // Multi-segment ghost trail that follows the card along its path. Spawns N
  // clone nodes per moved card, each parked at a fraction along the oldRect
  // → newRect segment. Newer segments (closer to the card) have higher opacity
  // and a larger scale; older segments (closer to the origin) fade out first.
  // alpha controls the NEWEST segment's opacity; the oldest is alpha * 0.2.
  // scale.start is the newest, scale.end is the oldest. segmentInterval is the
  // delay (s) between successive spawns so they cascade in over time.
  //
  // The CONTINUOUS drag mode uses different parameters:
  //   dragDuration         per-segment fade duration (longer than the post-move
  //                        duration so the trail feels like a real "wake" left
  //                        behind a dragged card).
  //   dragSpawnIntervalMs  minimum ms between successive segment spawns while
  //                        a drag is in progress (throttle for performance).
  //   maxConcurrent        shared DOM cap across cascade + continuous + multi-
  //                        card run spawns. Raised to 48 to support a long drag
  //                        (which can spawn 30+ segments/s for several seconds)
  //                        without starving the cascade or each other.
  ghostTrail: { duration: 0.45, ease: 'power1.out', alpha: 0.25, scale: { start: 1.0, end: 0.94 }, segments: 5, segmentInterval: 0.03, maxConcurrent: 48, dragDuration: 0.8, dragSpawnIntervalMs: 30 },

  // Wood frame entry (future GSAP reveal; currently CSS texture).
  boardFrame: { duration: 0.4, ease: 'power2.out' },

  // Enhanced win cascade — two-phase lift then fall. Gated by `winCascade`
  // only, independent of `cardEffects` and `winEnhanced` (confetti). Mobile cap
  // handled in winCascade.js.
  winEnhanced: {
    phase1: { duration: 0.12, ease: 'power2.out', stagger: 0.015 },
    phase2: { duration: 0.82, ease: 'power1.in', stagger: 0.1 },
  },

  // Confetti shower — independent celebration. Gated by `winEnhanced` only,
  // independent of `cardEffects` and `winCascade` (falling cards).
  confetti: {
    count: 32,
    duration: 1.1,
    ease: 'power2.in',
  },

  // Foundation particle burst: suit-glyph explosion from foundation center.
  // Outward accelerating (power2.in) up to radius px while fading.
  particles: {
    count: 10,            // per burst
    radius: 120,           // max travel px
    size: 44,             // glyph px
    duration: 0.55,       // per-particle lifetime (s)
    ease: 'power2.in',    // faster outward
    spin: 180,             // max rotation deg
  },

  // Achievement toast. slide: off-screen entrance; fade: dismiss/timeout.
  toast: {
    slide: { duration: 0.3, ease: 'power2.out', distance: 44 },
    fade: { duration: 0.2, ease: 'power1.out' },
  },

  // Modal entrance: panel grows from fromScale/fromOpacity to toScale/toOpacity.
  // back.out(1.7) gives slight overshoot pop; swap to power3.out for calm.
  modalEnter: {
    fromScale: 0.1,
    toScale: 1,
    fromOpacity: 0,
    toOpacity: 1,
    duration: 0.75,
    ease: 'back.out(1.7)',
  },
};

Object.defineProperty(MOTION.winEnhanced, 'confettiCount', {
  get() { return MOTION.confetti.count; },
  set(v) { MOTION.confetti.count = v; },
  enumerable: false,
});
