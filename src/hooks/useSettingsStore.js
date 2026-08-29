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
  cardBack: 'default',
  handedness: 'right',
  highlightCard: true,
  particles: true,
};

export const useSettingsStore = create((set, get) => ({
  theme: DEFAULTS.theme,
  deck: DEFAULTS.deck,
  cardBack: DEFAULTS.cardBack,
  handedness: DEFAULTS.handedness,
  highlightCard: DEFAULTS.highlightCard,
  particles: DEFAULTS.particles,
  seenThemeItemIds: [],
  loaded: false,

  /**
   * Load persisted settings from Dexie. Safe to call once on mount; missing
   * keys fall back to DEFAULTS. Activates the loaded (or default) deck.
   */
  init: async () => {
    const [theme, deck, cardBack, handedness, highlightCard, particles, seenThemeItemIds] = await Promise.all([
      getSetting('theme', DEFAULTS.theme),
      getSetting('deck', DEFAULTS.deck),
      getSetting('cardBack', DEFAULTS.cardBack),
      getSetting('handedness', DEFAULTS.handedness),
      getSetting('highlightCard', DEFAULTS.highlightCard),
      getSetting('particles', DEFAULTS.particles),
      getSetting('seenThemeItemIds', []),
    ]);
    setActiveDeck(deck);
    set({ theme, deck, cardBack, handedness, highlightCard, particles, seenThemeItemIds, loaded: true });
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
   * @param {string} cardBack  'default' or a cardBackRegistry key
   */
  setCardBack: (cardBack) => {
    set({ cardBack });
    setSetting('cardBack', cardBack);
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

  /**
   * Mark theme items as having been seen in the Theme modal so their "New"
   * badge stops showing. Merges with the existing set and persists to Dexie.
   * @param {string[]} ids
   */
  markThemeItemsSeen: (ids) => {
    if (!ids || ids.length === 0) return;
    set((s) => {
      const next = Array.from(new Set([...s.seenThemeItemIds, ...ids]));
      setSetting('seenThemeItemIds', next);
      return { seenThemeItemIds: next };
    });
  },
}));
