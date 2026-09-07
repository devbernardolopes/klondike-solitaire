/**
 * Centralized tableau auto-height / fan-compression config. Single source of
 * truth for every number and condition in the pile-height adjustment, mirroring
 * how render/animation/motion.js owns all tween timing.
 *
 * Layout pipeline (see components/Board.jsx measure + components/Pile.jsx):
 *   Board measures card/fan geometry + vertical budget -> metrics
 *   Pile compresses fanDown/fanUp via computeTableauFan() -> tops/pileHeight
 *
 * Live responsive tokens (--tableau-fan, --tableau-fan-down, ...) still live in
 * render/themes/classic.css + dark.css because they are viewport-relative
 * clamp() expressions. This module owns everything else AND documents which
 * CSS token pairs with which knob below, so tweaking = start here:
 *
 *   1. Floors ......... TABLEAU_LAYOUT.fallbacks (face-down tight peek is a
 *                        hard floor; only face-up compresses) + tuning.*Override
 *   2. Budget .......... computeAvailBudget() (what Board subtracts from
 *                        board.clientHeight before piles may use the rest)
 *   3. Smoothing ....... TABLEAU_LAYOUT.smooth (CSS transition on top/height;
 *                        killed automatically for prefers-reduced-motion via
 *                        the `.tableau-smooth-off` rule in the theme files)
 *   4. Breakpoints ..... TABLEAU_LAYOUT.largeScreen documents the media query
 *                        in the theme files. NOTE: `(min-width:1040px) and
 *                        (max-height:1000px)` does NOT match 1920x1080
 *                        (height 1080 > 1000), so Device-A keeps the 3px floor
 *                        while shorter desktop windows get 18px. If Device-A
 *                        compresses too harshly, either widen maxHeightPx here
 *                        + in CSS, or set tuning.fanDownMinOverride (takes
 *                        precedence over the measured CSS var, no CSS edit).
 *
 * Units: px for lengths, s for smooth.duration (matches MOTION seconds).
 */

export const TABLEAU_LAYOUT = {
  // Fallbacks when Board has not measured yet (metrics == null) or a CSS var
  // is missing. Must match the theme defaults so first paint == steady state.
  fallbacks: {
    fanDownMin: 3,
    fanUpEmergencyMin: 8,
    dragFanUpPx: 24,
  },

  // Optional single-file overrides for Device-A tuning. null = respect the
  // measured CSS var (current behavior). Set a number to force it live without
  // touching classic.css/dark.css. Example: { fanDownMinOverride: 12 }.
  tuning: {
    fanDownMinOverride: null,
    fanUpEmergencyMinOverride: null,
  },

  // Documents the `@media (min-width:1040px) and (max-height:1000px)` override
  // in classic.css/dark.css. Kept here so the breakpoint is visible next to
  // the values it changes; the CSS remains the enforcer (measured at runtime).
  largeScreen: {
    minWidthPx: 1040,
    maxHeightPx: 1000,
    fanDownMin: 18,
  },

  // Vertical-budget constants (see computeAvailBudget). Board reserves two
  // card heights (top row) + gaps/padding/frame + this reserve before piles
  // may use the rest.
  budget: {
    reservePx: 8,
    frameMarginPx: 16,
  },

  // Height-adjustment smoothing. Applied as an inline `transition` on the
  // tableau container (height) and each stacked card wrapper (top) in Pile.jsx.
  // Cheap: one compositor transition per card, auto-cancelled on rapid moves,
  // ~0 JS vs a per-card GSAP tween set that would fight the Flip move pipeline.
  smooth: { duration: 0.55, ease: 'ease-out' },
};

/**
 * Resolve the effective compression floors: explicit tuning override wins,
 * otherwise the measured CSS var, otherwise the fallback.
 */
export function resolveTableauMins(measured) {
  const m = measured || {};
  const downMin =
    TABLEAU_LAYOUT.tuning.fanDownMinOverride ??
    m.fanDownMin ??
    TABLEAU_LAYOUT.fallbacks.fanDownMin;
  const upEmergencyMin =
    TABLEAU_LAYOUT.tuning.fanUpEmergencyMinOverride ??
    m.fanUpEmergencyMin ??
    TABLEAU_LAYOUT.fallbacks.fanUpEmergencyMin;
  return { downMin, upEmergencyMin };
}

/**
 * Available vertical space for fan offsets beyond one card height.
 * Mirrors Board.jsx: board.clientHeight - 2*cardH - gap - 2*pad - 2*frame
 *   - frameMargin - reserve.
 */
export function computeAvailBudget({ boardH, cardH, gap, pad, frame, boardFrame }) {
  const frameMargin = boardFrame ? TABLEAU_LAYOUT.budget.frameMarginPx : 0;
  const reserve = TABLEAU_LAYOUT.budget.reservePx;
  return Math.max(0, boardH - 2 * cardH - gap - 2 * pad - 2 * frame - frameMargin - reserve);
}

/**
 * Core compression: face-down spacing is a hard floor (unrevealed state must
 * stay legible); only face-up spacing compresses when the pile exceeds budget.
 * Pure: never mutates `cards`, returns fresh tops/pileHeight.
 * @param {Array<{faceUp:boolean}>} cards
 * @param {{ cardH:number, fanUpMax:number, fanDownMax:number, downMin:number, upEmergencyMin:number, avail:number }} geom
 * @returns {{ fanUp:number, fanDown:number, tops:number[], pileHeight:number }}
 */
export function computeTableauFan(cards, geom) {
  const { cardH, fanUpMax, fanDownMax, downMin, upEmergencyMin, avail } = geom;
  const offsetCount = Math.max(0, cards.length - 1);
  let nDown = 0;
  let nUp = 0;
  for (let i = 0; i < offsetCount; i++) {
    if (cards[i].faceUp) nUp++;
    else nDown++;
  }
  let fanDown = fanDownMax;
  let fanUp = fanUpMax;
  const naturalExtra = nDown * fanDownMax + nUp * fanUpMax;
  if (avail > 0 && naturalExtra > avail) {
    fanDown = downMin;
    const remaining = avail - nDown * downMin;
    const strictFanUp = nUp > 0 ? Math.max(remaining / nUp, 0) : fanUpMax;
    fanUp = Math.max(strictFanUp, upEmergencyMin);
  }
  const tops = [];
  let acc = 0;
  for (let i = 0; i < cards.length; i++) {
    tops.push(acc);
    if (i < cards.length - 1) acc += cards[i].faceUp ? fanUp : fanDown;
  }
  return { fanUp, fanDown, tops, pileHeight: cardH + acc };
}

/**
 * Inline-transition value for the tableau container + card wrappers, e.g.
 * "height 0.25s ease-out". Property is prefixed by the caller.
 */
export function tableauTransition(prop) {
  const { duration, ease } = TABLEAU_LAYOUT.smooth;
  return `${prop} ${duration}s ${ease}`;
}
