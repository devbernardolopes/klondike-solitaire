import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';

export function playWinCascade() {
  const cards = gsap.utils.toArray('[data-card]');
  if (cards.length === 0) return;
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
  const foundationPiles = [];
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

  gsap.to(cards, {
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
      foundationPiles.forEach((p) => { p.style.zIndex = ''; });
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

