// render/animation/useCardMoveSlideBounce.js
// Pure decision / shape helper for the post-slide bounce tweens appended to
// the relocation timeline in useCardMoveSlide.js. Extracted as a pure
// function (no GSAP, no DOM) so the bounce timing contract is testable
// under node --test without needing a real DOM or animation runtime.
//
// Contract:
//   The bounce is a two-phase effect that fires AT the moment of landing,
//   not during the slide. Returning [] from buildBounceSteps() means "no
//   bounce" (the caller will append nothing). Otherwise the array contains
//   two steps: a duration-0 snap to the bounce state and a settle-back tween,
//   both positioned at the end of the slide (`cfg.duration`).
//
// The position value is critical: if the steps are placed at `0` instead
// of `cfg.duration`, the bounce fires CONCURRENT with the slide and the
// card inflates/rotates mid-flight (the reported "way too sharp, misplaced"
// bug from the prior Card Bounce implementation). This test guards that
// regression at the data level so a future GSAP integration refactor cannot
// silently move the steps back to `0`.

/**
 * Build the post-slide bounce tween steps.
 * @param {object} args
 * @param {object} args.cfg        MOTION config for the slide (e.g. MOTION.move)
 * @param {object} args.bounceCfg  MOTION.bounce config
 * @param {boolean} args.shouldBounce  whether the bounce is enabled
 * @returns {Array<{props:object,duration:number,position:number,ease:string}>}
 *   empty array when bounce is disabled, otherwise two steps:
 *     [0] snap to bounce state (duration 0, position cfg.duration)
 *     [1] settle to rest (duration bounceCfg.duration, position cfg.duration)
 */
export function buildBounceSteps({ cfg, bounceCfg, shouldBounce }) {
  if (!shouldBounce) return [];
  if (!bounceCfg) return [];
  if (!cfg || typeof cfg.duration !== 'number') return [];
  const position = cfg.duration;
  return [
    {
      props: {
        scale: bounceCfg.scale ?? 1.03,
        rotationZ: 0,
        boxShadow:
          bounceCfg.boxShadow ??
          '0 6px 16px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.22)',
      },
      duration: 0,
      position,
      ease: 'none',
    },
    {
      props: {
        scale: 1,
        rotationZ: 0,
        boxShadow: '0 4px 10px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.28)',
      },
      duration: bounceCfg.duration ?? 0.2,
      position,
      ease: bounceCfg.ease ?? 'back.out(0.6)',
    },
  ];
}
