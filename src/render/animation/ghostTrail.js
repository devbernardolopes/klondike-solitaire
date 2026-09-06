// render/animation/ghostTrail.js
// Framework-agnostic Ghost Trail pipeline. Spawns clone DOM nodes
// ("segments") at intervals during a move or drag; each segment fades to
// 0 opacity and is disposed on its own. **Segments are NEVER cancelled by
// re-drags or new moves** — they always fade organically up to their
// natural disposal, UNLESS evicted early to make room under the cap (see
// below). The DOM is capped separately per spawn mode — MOTION.ghostTrail.
// maxConcurrentCascade for post-move cascades and MOTION.ghostTrail.
// maxConcurrentDrag for continuous drag spawns — so a burst of one kind can
// never starve the other. Emission NEVER stops while the card is moving: when
// a mode's cap is hit, the single oldest live segment of that mode is
// disposed immediately (evictOldest()) to make room for the new spawn, rather
// than dropping the new spawn. The cap protects DOM/perf headroom, not
// emission continuity.
//
// Two spawn modes:
//
//   1. CASCADE — post-move (single-tap, auto-complete, undo).
//      Called once from useCardMoveSlide after a non-drag move completes.
//      Spawns `segments` clones at fractions along the oldRect → newRect
//      path with a per-segment delay (segmentInterval). Newer segments
//      have higher opacity (newest = full alpha, oldest = alpha * 0.2)
//      and a larger scale; the gradient gives a visible "trail" feel.
//
//   2. CONTINUOUS — during a drag (PointerSensor move events).
//      Called from useDragEngine's onDragMove handler, throttled to
//      `dragSpawnIntervalMs` per dragId. Each segment spawns at the
//      card's current cursor position with full alpha and scale.start;
//      per-segment fade uses `dragDuration` (longer than the post-move
//      fade so the trail feels like a real wake behind a dragged card).
//      For multi-card run drags, one segment is spawned per card in the
//      run (each offset by the fan spacing relative to the leader).

import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { useSettingsStore } from '../../hooks/useSettingsStore.js';

// Module-level registries of live trail segments, split by spawn kind so
// each kind gets its own DOM budget (MOTION.ghostTrail.maxConcurrentCascade /
// maxConcurrentDrag). This means a busy autocomplete chain (cascade spawns)
// can no longer starve an in-progress drag's continuous trail, and vice
// versa. Cleaned up on app unmount via clearAllGhostTrails().
const cascadeEls = new Set();
const dragEls = new Set();

// Per-dragId throttling state for continuous spawns. The map is keyed by
// dnd-kit active.id (a stable string per drag) and tracks the last
// performance.now() timestamp at which we spawned a segment for that
// drag. endDrag() removes the entry when the drag completes/cancels.
const lastDragSpawn = new Map();

/**
 * Read the live settings and short-circuit the pipeline if the user has
 * turned the trail off or is in reduced-motion mode.
 * @returns {boolean}
 */
function shouldShowTrail() {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch {}
  try {
    const s = useSettingsStore.getState();
    if (!s.cardEffects) return false;
    if (!s.ghostTrail) return false;
  } catch {
    return false;
  }
  return true;
}

/**
 * Clone the source card and append a fixed-position segment at the given
 * coords. Strips the inline transform GSAP applied to the source (so the
 * source could be parked at its old position via translate) and removes
 * the data-card/data-flip-id attributes so the clone is not mistaken for
 * a real card by other consumers (Flip bridge, dnd-kit, etc.).
 * @param {HTMLElement} sourceEl
 * @param {number} left
 * @param {number} top
 * @param {{width:number, height:number}} sourceRect
 * @param {number} opacity
 * @param {string|number} z
 * @param {number} scale
 * @returns {HTMLElement}
 */
function cloneAt(sourceEl, left, top, sourceRect, opacity, z, scale, kind = 'cascade') {
  const g = sourceEl.cloneNode(true);
  g.style.position = 'fixed';
  g.style.left = `${left}px`;
  g.style.top = `${top}px`;
  g.style.width = `${sourceRect.width}px`;
  g.style.height = `${sourceRect.height}px`;
  g.style.margin = '0';
  g.style.pointerEvents = 'none';
  g.style.zIndex = String(z);
  g.style.opacity = String(opacity);
  g.style.transform = 'none';
  g.style.removeProperty('translate');
  g.style.scale = String(scale);
  // The source card node may be visibility:hidden (e.g. the real DOM node
  // behind an active DragOverlay). cloneNode(true) copies that inline style
  // verbatim, so without this the clone would silently render invisible.
  // Trail segments must always be visible regardless of the source's own
  // visibility state.
  g.style.visibility = 'visible';
  g.style.display = '';
  g.removeAttribute('data-card');
  g.removeAttribute('data-flip-id');
  document.body.appendChild(g);
  const set = kind === 'drag' ? dragEls : cascadeEls;
  set.add(g);
  return g;
}

/**
 * Evict the single oldest live segment from the given tracking Set to make
 * room for a new one. Set iteration order is insertion order, so the first
 * value is always the oldest still-live segment. Kills its fade tween early
 * (skipping its own onComplete cleanup, which we do manually here) and
 * removes the DOM node immediately. No-op if the set is empty.
 * @param {Set<HTMLElement>} set
 */
function evictOldest(set) {
  const oldest = set.values().next().value;
  if (!oldest) return;
  try { oldest._ghostTween?.kill(); } catch {}
  try { oldest.remove(); } catch {}
  set.delete(oldest);
}

/**
 * Cascade spawn — one call per non-drag move. Spawns N segments at
 * fractions along the oldRect → newRect path with a staggered delay.
 * Newer segments (closer to the card) have higher opacity and a larger
 * scale; older segments (closer to the origin) have lower opacity and
 * a smaller scale, fading to 0 by their own GSAP tween.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.sourceEl   card DOM node to clone from
 * @param {DOMRect} opts.sourceRect     the OLD rect (where the card came from)
 * @param {DOMRect} opts.targetRect     the NEW rect (where the card landed)
 */
export function spawnTrailCascade({ sourceEl, sourceRect, targetRect }) {
  if (!shouldShowTrail() || !sourceEl || !sourceRect || !targetRect) return;
  const cfg = MOTION.ghostTrail;
  if (!cfg) return;
  const segments = cfg.segments ?? 5;
  const segmentInterval = cfg.segmentInterval ?? 0.03;
  const segmentDuration = cfg.duration / segments;
  const alpha = cfg.alpha ?? 0.25;
  const scaleStart = cfg.scale?.start ?? 1.0;
  const scaleEnd = cfg.scale?.end ?? 0.94;
  const maxConcurrentCascade = cfg.maxConcurrentCascade ?? 30;
  const dx = targetRect.left - sourceRect.left;
  const dy = targetRect.top - sourceRect.top;
  if (dx === 0 && dy === 0) return; // no displacement → no trail needed
  for (let s = 0; s < segments; s++) {
    const fraction = (s + 1) / segments;
    const left = sourceRect.left + dx * fraction;
    const top = sourceRect.top + dy * fraction;
    const opacity = alpha * (1 - fraction * 0.8);
    const scale = scaleStart - (scaleStart - scaleEnd) * fraction;
    // Defer creation itself (not just the fade) so segments pop in one at a
    // time as the card would be passing through that point — matching the
    // real-time, organic cadence of the drag trail instead of stamping the
    // whole path into the DOM at once. The concurrency check moves in here
    // too, since it now must reflect DOM state at actual spawn time.
    gsap.delayedCall(s * segmentInterval, () => {
      // Never stop emitting: if we're at the cap, dispose the oldest live
      // segment to make room instead of dropping this new spawn.
      if (cascadeEls.size >= maxConcurrentCascade) evictOldest(cascadeEls);
      const seg = cloneAt(sourceEl, left, top, sourceRect, opacity, '10', scale, 'cascade');
      seg._ghostTween = gsap.to(seg, {
        opacity: 0,
        scale: scale * 0.92,
        duration: segmentDuration,
        ease: cfg.ease ?? 'power2.out',
        onComplete: () => { try { seg.remove(); } catch {} cascadeEls.delete(seg); },
      });
    });
  }
}

/**
 * Continuous-drag spawn — one call per pointer move during an active
 * drag. Throttled to MOTION.ghostTrail.dragSpawnIntervalMs per dragId so
 * we don't drown the DOM at 120 Hz on a high-refresh display. The
 * segment fades over `dragDuration` (longer than the post-move fade so
 * the trail feels like a real wake behind a dragged card).
 *
 * The caller passes the live `targetRect` (the card's current screen
 * position) — for single-card drags this is the DragOverlay rect; for
 * multi-card run drags, the caller (useDragEngine.onDragMove) offsets
 * the rect by the fan spacing per card in the run.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.sourceEl   card DOM node to clone from
 * @param {{left:number, top:number, width:number, height:number}} opts.targetRect
 * @param {string} opts.dragId         dnd-kit active.id (used as throttle key)
 * @param {string|number} [opts.z]      z-index; default 15 (above cascade, below all cards)
 */
export function spawnDragSegment({ sourceEl, targetRect, dragId, z = '15' }) {
  if (!shouldShowTrail() || !sourceEl || !targetRect) return;
  const cfg = MOTION.ghostTrail;
  if (!cfg) return;
  const interval = cfg.dragSpawnIntervalMs ?? 30;
  const now = performance.now();
  const last = lastDragSpawn.get(dragId) ?? 0;
  if (now - last < interval) return;
  lastDragSpawn.set(dragId, now);
  const maxConcurrentDrag = cfg.maxConcurrentDrag ?? 24;
  // Never stop emitting: if we're at the cap, dispose the oldest live
  // segment to make room instead of dropping this new spawn.
  if (dragEls.size >= maxConcurrentDrag) evictOldest(dragEls);
  const alpha = cfg.alpha ?? 0.25;
  const scaleStart = cfg.scale?.start ?? 1.0;
  const seg = cloneAt(sourceEl, targetRect.left, targetRect.top, targetRect, alpha, z, scaleStart, 'drag');
  seg._ghostTween = gsap.to(seg, {
    opacity: 0,
    scale: scaleStart * 0.92,
    duration: cfg.dragDuration ?? 0.8,
    ease: cfg.ease ?? 'power2.out',
    onComplete: () => { try { seg.remove(); } catch {} dragEls.delete(seg); },
  });
}

/**
 * Called from useDragEngine on drag end / cancel to clear the per-drag
 * throttle state. Does NOT cancel any in-flight trail segments — those
 * always fade organically up to their disposal (per spec).
 * @param {string} dragId
 */
export function endDrag(dragId) {
  lastDragSpawn.delete(dragId);
}

/** Remove every live trail segment and clear throttle state. Called on app unmount. */
export function clearAllGhostTrails() {
  cascadeEls.forEach((el) => { try { el.remove(); } catch {} });
  cascadeEls.clear();
  dragEls.forEach((el) => { try { el.remove(); } catch {} });
  dragEls.clear();
  lastDragSpawn.clear();
}
