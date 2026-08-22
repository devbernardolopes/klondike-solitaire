import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { useUiStore } from '../../hooks/useUiStore.js';

// Module-level handles so a new-game request can abort an in-flight cascade.
let winTween = null;
let foundationPiles = [];

/**
 * Abort a running win cascade immediately (e.g. when the user starts a new
 * game mid-fall). Kills the tween, drops the temporary foundation z-index
 * lift and any leftover inline styles, and releases the global lock so the
 * deal can proceed without waiting for the animation to finish. Safe no-op
 * when no cascade is active.
 */
export function cancelWinCascade() {
  if (winTween) {
    winTween.kill();
    winTween = null;
  }
  if (foundationPiles.length) {
    foundationPiles.forEach((p) => { p.style.zIndex = ''; });
    foundationPiles = [];
  }
  const cards = gsap.utils.toArray('[data-card]');
  if (cards.length) gsap.set(cards, { clearProps: 'all' });
  useUiStore.getState().setFullLock(false);
}

export function playWinCascade() {
  // A hidden/background tab pauses requestAnimationFrame, so an rAF-driven
  // cascade would stall until refocus. The win is already recorded by the caller,
  // so simply skip the visual celebration when hidden — it will not play.
  if (typeof document !== 'undefined' && document.hidden) return;
  const cards = gsap.utils.toArray('[data-card]');
  if (cards.length === 0) return;
  foundationPiles = [];
  // Hold the all-encompassing lock so new-game / undo / redo can't fire while
  // the falling-card cascade is playing (won === true already blocks card/pile
  // interaction in the components, but the store-level new-game guard keys off
  // this flag too).
  useUiStore.getState().setFullLock(true);
  // The cascade kills any in-flight winning-move tween below, which means that
  // tween's onComplete (and therefore its endTransition) never fires. Release
  // every granular lock now so the board isn't left stuck and a later "New
  // Game" isn't blocked by a leaked transition.
  useUiStore.getState().clearAllTransitions();
  // Kill any Flip.from tweens still in flight from the winning move / the
  // auto-complete moves just before it, and clear their leftover inline
  // transform/position, so the cascade is the sole animator. Otherwise Flip's
  // onComplete cleanup snaps cards back to rest, leaving some (e.g. the buried
  // "2" in a foundation stack) looking static while neighbours tumble.
  gsap.killTweensOf(cards);
  gsap.set(cards, { clearProps: 'transform,position' });

  // Foundation piles are rendered non-fanned: all 13 cards share one x/y and
  // stack with zIndex = pile position (Ace=0 … King=12), so only the top (King)
  // is visible and the Ace/2 sit at the BOTTOM of the paint order. Two bugs
  // used to leave those buried cards looking frozen:
  //
  //  1. The fan step was capped at half a card height, so every foundation card
  //     permanently overlapped its neighbor by >=50% — Ace needed the most
  //     cumulative clearance but got the least.
  //  2. GSAP's default (array-order) stagger gave Ace (index 0 in its pile, and
  //     the first card in DOM order) the smallest delay AND the smallest travel
  //     (idx * fanStep = 0), so it finished moving before the cards covering it
  //     had even started.
  //
  // Fix: fan each foundation card by a full card height per index (capped only
  // to fit the viewport, so the 13-card column stays on-screen and every card
  // is unobstructed), and reverse the stagger (from: 'end') so the top of each
  // stack (King) peels away first, revealing the buried Ace/2 beneath. We also
  // raise the foundation piles above the rest of the board so flying tableau
  // cards never hide them.
  const cardH = measureVar('var(--card-height)');
  const bottomMargin = MOTION.win.bottomMargin;
  let fanStep = 0;
  let uniformFall = 0;
  for (const el of cards) {
    const pile = el.closest('[data-loc^="foundation"]');
    if (!pile) continue;

    // Compute the column geometry once (it's identical for every foundation
    // card, since they all share the same starting position).
    if (fanStep === 0) {
      const rect = el.getBoundingClientRect();
      const colH = Math.max(0, window.innerHeight - rect.top - bottomMargin - cardH);
      // Full card-height separation per index so no card stays overlapped; the
      // step is capped to colH/12 only so the whole column fits on screen on
      // shorter viewports (and the leftover space becomes a uniform drop).
      fanStep = Math.min(cardH, colH / 12);
      uniformFall = Math.max(0, colH - 12 * fanStep);
    }

    const idx = parseInt(el.parentElement?.style.zIndex || '0', 10);
    el._fanY = idx * fanStep;
    el._fallY = uniformFall;
    // Lift the whole pile above the rest of the board for the cascade.
    pile.style.zIndex = '2000';
    foundationPiles.push(pile);
  }

  winTween = gsap.to(cards, {
    // Foundation cards hold their column (no scatter) so the fanned stack stays
    // intact and every card is revealed; the other piles get the random
    // horizontal scatter for the confetti effect.
    x: (i, el) => (el._fanY != null ? 0 : gsap.utils.random(-90, 90)),
    // Foundation cards drop by the shared uniform fall plus their fan offset,
    // revealing the whole column. Other cards fall by a viewport-clamped amount.
    y: (i, el) => {
      if (el._fallY != null) return el._fallY + (el._fanY || 0);
      const rect = el.getBoundingClientRect();
      const maxFall = Math.max(0, window.innerHeight - rect.bottom - bottomMargin);
      return Math.min(MOTION.win.flyDistance, maxFall);
    },
    rotation: () => gsap.utils.random(-60, 60),
    stagger: { each: MOTION.win.stagger, from: 'end' },
    duration: MOTION.win.duration,
    ease: MOTION.win.ease,
    // Drop the temporary z-index lift so it doesn't leak into the next game
    // (the cards themselves stay where the cascade left them).
    onComplete: () => {
      winTween = null;
      useUiStore.getState().setFullLock(false);
      foundationPiles.forEach((p) => { p.style.zIndex = ''; });
      foundationPiles = [];
    },
  });
}

// Resolve a CSS length expression (clamp()/calc()/var()) to a pixel number by
// mounting a hidden probe element. Used here to size the foundation fan step.
function measureVar(expr) {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;height:${expr};`;
  document.body.appendChild(probe);
  const px = probe.offsetHeight;
  document.body.removeChild(probe);
  return px;
}

