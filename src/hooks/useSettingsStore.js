// hooks/useSettingsStore.js
// Persisted UI settings (theme + active deck) backed by the Dexie `settings`
// table (see db/schema.js). Loads asynchronously on app start; writes through to
// Dexie on every change so selections survive reloads.
//
// Deck changes also drive the active renderer in deckRegistry so CardView can
// re-render faces from the right source.

import { create } from 'zustand';
import { setActiveDeck } from '../render/deck/deckRegistry.js';
import { getSetting, setSetting } from '../db/schema.js';

const DEFAULTS = {
  theme: 'classic',
  deck: 'procedural',
  handedness: 'right',
  highlightCard: true,
  particles: true,
};

export const useSettingsStore = create((set, get) => ({
  theme: DEFAULTS.theme,
  deck: DEFAULTS.deck,
  handedness: DEFAULTS.handedness,
  highlightCard: DEFAULTS.highlightCard,
  particles: DEFAULTS.particles,
  loaded: false,

  /**
   * Load persisted settings from Dexie. Safe to call once on mount; missing
   * keys fall back to DEFAULTS. Activates the loaded (or default) deck.
   */
  init: async () => {
    const [theme, deck, handedness, highlightCard, particles] = await Promise.all([
      getSetting('theme', DEFAULTS.theme),
      getSetting('deck', DEFAULTS.deck),
      getSetting('handedness', DEFAULTS.handedness),
      getSetting('highlightCard', DEFAULTS.highlightCard),
      getSetting('particles', DEFAULTS.particles),
    ]);
    setActiveDeck(deck);
    set({ theme, deck, handedness, highlightCard, particles, loaded: true });
  },

  /**
   * @param {string} theme
   */
  setTheme: (theme) => {
    set({ theme });
    setSetting('theme', theme);
  },

  /**
   * @param {string} deck  registered deck/renderer name
   */
  setDeck: (deck) => {
    setActiveDeck(deck);
    set({ deck });
    setSetting('deck', deck);
  },

  /**
   * @param {'left'|'right'} handedness  board pile arrangement
   */
  setHandedness: (handedness) => {
    set({ handedness });
    setSetting('handedness', handedness);
  },

  /**
   * @param {boolean} highlightCard  draw the focus/selection outline on the focused card
   */
  setHighlightCard: (highlightCard) => {
    set({ highlightCard });
    setSetting('highlightCard', highlightCard);
  },

  /**
   * @param {boolean} particles  enable the foundation suit-burst particle effect
   */
  setParticles: (particles) => {
    set({ particles });
    setSetting('particles', particles);
  },
}));
