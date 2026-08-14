// hooks/useDragEngine.js
// Thin wrapper around @dnd-kit for pile-to-pile card moves.
// Calls into the Zustand store (which delegates to core/moveEngine.js).
//
// Supports multi-card run dragging: grabbing any face-up tableau card lifts the
// valid descending-alternating run beneath it (see core/rules.js getTableauRun).

import { useState } from 'react';
import {
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
} from '@dnd-kit/core';
import { useGameStore } from './useGameStore.js';
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
    // TODO: attach focus/tabindex + key handlers for keyboard-driven drag (out of scope this pass).
  );

  function onDragStart(event) {
    const id = event.active.id;
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
  }

  function onDragEnd(event) {
    setActiveId(null);
    setActiveRun(null);
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data?.current;
    const overData = over.data?.current;
    if (!activeData || !overData) return;
    const { from, cardId } = activeData;
    const { loc: to } = overData;
    if (from && to) {
      // Store validates legality via core/rules.js and ignores invalid moves.
      moveCard(from, to, cardId);
    }
  }

  function onDragCancel() {
    setActiveId(null);
    setActiveRun(null);
  }

  return { sensors, onDragStart, onDragEnd, onDragCancel, activeId, activeRun };
}
