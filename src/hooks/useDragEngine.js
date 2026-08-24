// hooks/useDragEngine.js
// Thin wrapper around @dnd-kit for pile-to-pile card moves.
// Calls into the Zustand store (which delegates to core/moveEngine.js).
//
// Supports multi-card run dragging: grabbing any face-up tableau card lifts the
// valid descending-alternating run beneath it (see core/rules.js getTableauRun).

import { useEffect, useRef, useState } from 'react';
import {
  useSensor,
  useSensors,
  PointerSensor,
} from '@dnd-kit/core';
import { useGameStore } from './useGameStore.js';
import { useUiStore } from './useUiStore.js';
import { getTableauRun } from '../core/rules.js';

/**
 * Read a pile array from state by locator (mirrors the store's readPile).
 * @param {import('../core/GameState.js').GameState} s
 * @param {string} loc
 */
function readPile(s, loc) {
  if (loc === 'stock') return s.stock;
  if (loc === 'waste') return s.waste;
  const [kind, idx] = loc.split(':');
  return kind === 'foundation' ? s.foundations[Number(idx)] : s.tableau[Number(idx)];
}

/**
 * @returns {{
 *   sensors: ReturnType<typeof useSensors>,
 *   onDragStart: (e: any) => void,
 *   onDragEnd: (e: any) => void,
 *   onDragCancel: () => void,
 *   activeId: string | null,
 *   activeRun: Array<{id:string, suit:string, rank:number, color:string, faceUp:boolean}> | null,
 * }}
 */
export function useDragEngine() {
  const moveCard = useGameStore((s) => s.moveCard);
  const [activeId, setActiveId] = useState(null);
  const [activeRun, setActiveRun] = useState(null);

  // Tracks whether a primary pointer is currently pressed. dnd-kit activates a
  // drag asynchronously (after the 8px threshold is crossed), so on a very fast
  // gesture (down → tiny move → up within one frame, e.g. a frantic click/drag/
  // double-click) onDragStart can fire *after* the pointer was already released.
  // In that case neither onDragEnd nor onDragCancel fires, leaving activeRun (and
  // thus the source card's hiddenIds) set forever — the card stays visibility:hidden.
  const pointerDownRef = useRef(false);

  const sensors = useSensors(
    // 8px threshold: a tap (< CLICK_DISTANCE in CardView) is an auto-move, while
    // a deliberate drag (>= 8px) initiates a drag. Keeps click and drag separate.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Keyboard play is handled by explicit focusable cards/piles + the global
    // shortcut handler in Board.jsx (rather than dnd-kit's KeyboardSensor), so
    // Enter/Space on a focused card performs an auto-move and Enter on a focused
    // pile moves the selected card there.
  );

  // Safety net: clear drag state whenever the primary pointer is released (or a
  // pointer is cancelled). This guarantees a card can never stay hidden because
  // dnd-kit missed its onDragEnd/onDragCancel, and it also neutralizes the
  // late-activation zombie described above on the release side.
  useEffect(() => {
    const onDown = (e) => {
      if (e.button === 0) pointerDownRef.current = true;
    };
    const onUp = (e) => {
      if (e.button !== 0 && e.type !== 'pointercancel') return;
      pointerDownRef.current = false;
      setActiveId(null);
      setActiveRun(null);
      useUiStore.getState().setIsDragging(false);
      useUiStore.getState().clearDragContext();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  function onDragStart(event) {
    // Ignore a drag that activates after the pointer was already released (the
    // async-activation race). Without this guard it would set activeRun with no
    // matching end, leaving the card hidden.
    if (!pointerDownRef.current) {
      setActiveId(null);
      setActiveRun(null);
      return;
    }
    const id = event.active.id;
    useUiStore.getState().setIsDragging(true);
    setActiveId(id);
    const data = event.active.data?.current;
    if (!data) {
      setActiveRun(null);
      return;
    }
    const { from, cardId } = data;
    const pile = readPile(useGameStore.getState().state, from);
    const idx = pile.findIndex((c) => c.id === cardId);
    if (idx === -1) {
      setActiveRun(null);
      return;
    }
    // Lift the full run for tableau sources; a single card elsewhere.
    const run = from.startsWith('tableau') ? getTableauRun(pile, cardId) : [pile[idx]];
    setActiveRun(run);
    // Expose the drag source + lead card so piles can gate their hover highlight.
    useUiStore.getState().setDragContext(from, run[0]);
  }

  function onDragEnd(event) {
    setActiveId(null);
    setActiveRun(null);
    useUiStore.getState().setIsDragging(false);
    useUiStore.getState().clearDragContext();
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data?.current;
    const overData = over.data?.current;
    if (!activeData || !overData) return;
    const { from, cardId } = activeData;
    const { loc: to } = overData;
    if (from && to) {
      // Store validates legality via core/rules.js and ignores invalid moves.
      // metaType:'drag' tells moveCard to snap the card in place (no slide),
      // since the DragOverlay already showed it at the drop target.
      moveCard(from, to, cardId, { metaType: 'drag' });
    }
  }

  function onDragCancel() {
    setActiveId(null);
    setActiveRun(null);
    useUiStore.getState().setIsDragging(false);
    useUiStore.getState().clearDragContext();
  }

  return { sensors, onDragStart, onDragEnd, onDragCancel, activeId, activeRun };
}
