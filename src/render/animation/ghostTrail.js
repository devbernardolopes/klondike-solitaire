// render/animation/ghostTrail.js
// Framework-agnostic Ghost Trail pipeline. Spawns clone DOM nodes
// ("segments") at intervals during a move or drag; each segment fades to
// 0 opacity and is disposed on its own. **Segments are NEVER cancelled by
// re-drags or new moves** — they always fade organically up to their
// natural disposal. The DOM is capped at MOTION.ghostTrail.maxConcurrent
// to prevent runaway growth; when the cap is hit, new spawns are dropped
// (newest wins — the cap protects performance, not visual continuity).
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

// Module-level registry of all live trail segments. Cleaned up on app
// unmount via clearAllGhostTrails().
const trailEls = new Set();

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
function cloneAt(sourceEl, left, top, sourceRect, opacity, z, scale) {
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
  g.removeAttribute('data-card');
  g.removeAttribute('data-flip-id');
  document.body.appendChild(g);
  trailEls.add(g);
  return g;
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
  const maxConcurrent = cfg.maxConcurrent ?? 48;
  const dx = targetRect.left - sourceRect.left;
  const dy = targetRect.top - sourceRect.top;
  if (dx === 0 && dy === 0) return; // no displacement → no trail needed
  for (let s = 0; s < segments; s++) {
    if (trailEls.size >= maxConcurrent) break;
    const fraction = (s + 1) / segments;
    const left = sourceRect.left + dx * fraction;
    const top = sourceRect.top + dy * fraction;
    const opacity = alpha * (1 - fraction * 0.8);
    const scale = scaleStart - (scaleStart - scaleEnd) * fraction;
    const seg = cloneAt(sourceEl, left, top, sourceRect, opacity, '1400', scale);
    gsap.to(seg, {
      opacity: 0,
      scale: scale * 0.92,
      duration: segmentDuration,
      ease: cfg.ease ?? 'power2.out',
      delay: s * segmentInterval,
      onComplete: () => { try { seg.remove(); } catch {} trailEls.delete(seg); },
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
 * @param {string|number} [opts.z]      z-index; default 1450 (above the cascade)
 */
export function spawnDragSegment({ sourceEl, targetRect, dragId, z = '1450' }) {
  if (!shouldShowTrail() || !sourceEl || !targetRect) return;
  const cfg = MOTION.ghostTrail;
  if (!cfg) return;
  const interval = cfg.dragSpawnIntervalMs ?? 30;
  const now = performance.now();
  const last = lastDragSpawn.get(dragId) ?? 0;
  if (now - last < interval) return;
  lastDragSpawn.set(dragId, now);
  const maxConcurrent = cfg.maxConcurrent ?? 48;
  if (trailEls.size >= maxConcurrent) return;
  const alpha = cfg.alpha ?? 0.25;
  const scaleStart = cfg.scale?.start ?? 1.0;
  const seg = cloneAt(sourceEl, targetRect.left, targetRect.top, targetRect, alpha, z, scaleStart);
  gsap.to(seg, {
    opacity: 0,
    scale: scaleStart * 0.92,
    duration: cfg.dragDuration ?? 0.8,
    ease: cfg.ease ?? 'power2.out',
    onComplete: () => { try { seg.remove(); } catch {} trailEls.delete(seg); },
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
  trailEls.forEach((el) => { try { el.remove(); } catch {} });
  trailEls.clear();
  lastDragSpawn.clear();
}
