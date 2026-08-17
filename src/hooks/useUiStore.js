// hooks/useUiStore.js
// Tiny UI-only store for keyboard accessibility: which card is "selected"
// (focused + highlighted) and a live-region announcement string for screen
// readers. Not part of core/GameState and not persisted.

import { create } from 'zustand';

export const useUiStore = create((set) => ({
  selectedCardId: null,
  announce: '',
  noMovesDialogOpen: false,

  // New Game mode-picker dialog state + the last mode chosen, so the "no valid
  // moves" recovery path can re-deal with the same mode without re-prompting.
  newGameDialogOpen: false,
  lastNewGameMode: 'winning', // 'winning' | 'random'

  // Options/settings modal (Theme / Deck / Hand).
  settingsDialogOpen: false,

  /** Mark a card as the keyboard-selected card. */
  selectCard: (id) => set({ selectedCardId: id }),

  /** Show/hide the "no valid moves remaining" dialog. */
  setNoMovesDialogOpen: (open) => set({ noMovesDialogOpen: open }),

  /** Show/hide the New Game mode-picker dialog. */
  setNewGameDialogOpen: (open) => set({ newGameDialogOpen: open }),

  /** Show/hide the options/settings dialog. */
  setSettingsDialogOpen: (open) => set({ settingsDialogOpen: open }),

  /** Record which mode was last used, so the "no valid moves" recovery path can reuse it. */
  setLastNewGameMode: (mode) => set({ lastNewGameMode: mode }),

  /** Clear the current selection (after a move or on new game). */
  clearSelection: () => set({ selectedCardId: null }),

  /** Update the aria-live announcement text. */
  setAnnounce: (text) => set({ announce: text }),
}));

/**
 * Locate the pile a card currently lives in.
 * @param {import('../core/GameState.js').GameState} state
 * @param {string} cardId
 * @returns {string|null} pile locator or null if not found
 */
export function findCardLocator(state, cardId) {
  for (let i = 0; i < state.tableau.length; i++) {
    if (state.tableau[i].some((c) => c.id === cardId)) return `tableau:${i}`;
  }
  if (state.waste.some((c) => c.id === cardId)) return 'waste';
  for (let i = 0; i < state.foundations.length; i++) {
    if (state.foundations[i].some((c) => c.id === cardId)) return `foundation:${i}`;
  }
  if (state.stock.some((c) => c.id === cardId)) return 'stock';
  return null;
}
