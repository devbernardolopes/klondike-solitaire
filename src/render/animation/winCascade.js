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
  // stack with zIndex = pile index (Ace=0 … King=12), so only the top (King) is
  // visible and the Ace/2 sit at the BOTTOM of the paint order. A random
  // horizontal scatter (below) used to lump them into a cloud where every
  // overlap is won by the higher-z sibling — so the Ace and 2 were *always*
  // painted behind another foundation card and appeared never to fall.
  //
  // Fix: fan each foundation card into a deterministic vertical column (no
  // random horizontal scatter, so the column stays intact) and drop the whole
  // column together. With natural within-pile z-order, each card's top edge
  // reads as a strip of the fanned column, so every card — Ace, 2, …, King —
  // is revealed and clearly moves. We also raise the foundation piles above the
  // rest of the board so flying tableau cards never hide them.
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
      // Step sizes the 12 gaps so the 13-card column fits on screen AND leaves
      // ~40% of the available space as a uniform drop for the whole column.
      fanStep = Math.min(cardH * 0.5, (colH * 0.6) / 12);
      uniformFall = Math.max(0, colH - 12 * fanStep);
    }

    const idx = parseInt(el.parentElement?.style.zIndex || '0', 10);
    el._fanY = idx * fanStep;
    el._fallY = uniformFall;
    // Lift the whole pile above the rest of the board for the cascade.
    pile.style.zIndex = '2000';
  }

  gsap.to(cards, {
    // Foundation cards hold their column (no scatter) so the fanned stack stays
    // intact and every card is revealed; the other piles get the random
    // horizontal scatter for the confetti effect.
    x: (i, el) => (el._fanY != null ? 0 : gsap.utils.random(-90, 90)),
    // Foundation cards drop by the shared uniform fall plus their fan offset,
    // revealing the whole column. Other cards fall by a viewport-clamped amount
    // (the fan offset is no longer double-counted, so nothing overflows).
    y: (i, el) => {
      if (el._fallY != null) return el._fallY + (el._fanY || 0);
      const rect = el.getBoundingClientRect();
      const maxFall = Math.max(0, window.innerHeight - rect.bottom - bottomMargin);
      return Math.min(MOTION.win.flyDistance, maxFall);
    },
    rotation: () => gsap.utils.random(-60, 60),
    stagger: MOTION.win.stagger,
    duration: MOTION.win.duration,
    ease: MOTION.win.ease,
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

