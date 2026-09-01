// Pure per-game achievement telemetry transitions.
// This module intentionally does not depend on React, the DOM, or Zustand.

export function createAchievementTelemetry(gameId) {
  return {
    gameId,
    hintUsed: false,
    undoUsed: false,
    tableauToTableauMoves: 0,
    foundationMoves: 0,
    foundationToTableauMoves: 0,
    recycleCount: 0,
    foundationFirstEligible: true,
    aceCollectorEligible: true,
    acesToFoundation: 0,
    aceIdsToFoundation: [],
  };
}

export function markHintUsed(telemetry) {
  return { ...telemetry, hintUsed: true };
}

export function markUndoUsed(telemetry) {
  return { ...telemetry, undoUsed: true };
}

export function recordRecycle(telemetry) {
  return { ...telemetry, recycleCount: telemetry.recycleCount + 1 };
}

export function recordAchievementMove(telemetry, { from, to, card }) {
  const next = { ...telemetry };
  if (from.startsWith('tableau') && to.startsWith('tableau')) {
    next.tableauToTableauMoves += 1;
    if (telemetry.foundationMoves === 0) next.foundationFirstEligible = false;
  }
  if (from.startsWith('foundation') && to.startsWith('tableau')) {
    next.foundationToTableauMoves += 1;
  }
  if (to.startsWith('foundation')) {
    next.foundationMoves += 1;
    if (card?.rank === 1 && card.id && !telemetry.aceIdsToFoundation.includes(card.id)) {
      next.aceIdsToFoundation = [...telemetry.aceIdsToFoundation, card.id];
      next.acesToFoundation += 1;
    } else if (card?.rank !== 1 && telemetry.aceIdsToFoundation.length < 4) {
      next.aceCollectorEligible = false;
    }
  }
  return next;
}
