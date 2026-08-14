// hooks/useDragEngine.js
// Thin wrapper around @dnd-kit for pile-to-pile card moves.
// Calls into the Zustand store (which delegates to core/moveEngine.js).
//
// Single top-card moves only this pass.
// TODO: multi-card run dragging (drag a valid tableau sequence together).

import { useState } from 'react';
import {
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
} from '@dnd-kit/core';
import { useGameStore } from './useGameStore.js';

/**
 * @returns {{
 *   sensors: ReturnType<typeof useSensors>,
 *   onDragStart: (e: any) => void,
 *   onDragEnd: (e: any) => void,
 *   onDragCancel: () => void,
 *   activeId: string | null,
 * }}
 */
export function useDragEngine() {
  const moveCard = useGameStore((s) => s.moveCard);
  const [activeId, setActiveId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
    // TODO: attach focus/tabindex + key handlers for keyboard-driven drag (out of scope this pass).
  );

  function onDragStart(event) {
    setActiveId(event.active.id);
  }

  function onDragEnd(event) {
    setActiveId(null);
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
  }

  return { sensors, onDragStart, onDragEnd, onDragCancel, activeId };
}
