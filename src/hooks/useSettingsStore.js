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
  interfaceTheme: 'classic',
  deck: 'procedural',
  cardBack: 'default',
  handedness: 'right',
  highlightCard: true,
  particles: true,
  cardEffects: true,
  tableTexture: true,
  boardFrame: true,
};

// Synchronous mirrors of the settings that affect first paint (theme + board
// layout). IndexedDB/Dexie is async and cannot be read before React paints, so
// we also persist these to localStorage on every change and seed the store's
// initial state from there. This prevents the classic flash-of-default-theme
// (or wrong handedness) on reload/refresh: the store already holds the saved
// value at first render, before the async Dexie init() resolves.
const LS_KEYS = {
  theme: 'klondike:theme',
  interfaceTheme: 'klondike:interfaceTheme',
  handedness: 'klondike:handedness',
};

function readLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage may be unavailable (private mode); Dexie remains the source of truth */
  }
}

export const useSettingsStore = create((set, get) => ({
  theme: readLS(LS_KEYS.theme, DEFAULTS.theme),
  interfaceTheme: readLS(LS_KEYS.interfaceTheme, DEFAULTS.interfaceTheme),
  deck: DEFAULTS.deck,
  cardBack: DEFAULTS.cardBack,
  handedness: readLS(LS_KEYS.handedness, DEFAULTS.handedness),
  highlightCard: DEFAULTS.highlightCard,
  particles: DEFAULTS.particles,
  cardEffects: DEFAULTS.cardEffects,
  tableTexture: DEFAULTS.tableTexture,
  boardFrame: DEFAULTS.boardFrame,
  seenThemeItemIds: [],
  seenAchievementIds: [],
  themeModalTab: 'interface',
  loaded: false,

  /**
   * Load persisted settings from Dexie. Safe to call once on mount; missing
   * keys fall back to DEFAULTS. Activates the loaded (or default) deck.
   */
  init: async () => {
    const [theme, interfaceTheme, deck, cardBack, handedness, highlightCard, particles, cardEffects, tableTexture, boardFrame, seenThemeItemIds, seenAchievementIds, themeModalTab] = await Promise.all([
      getSetting('theme', DEFAULTS.theme),
      getSetting('interfaceTheme', DEFAULTS.interfaceTheme),
      getSetting('deck', DEFAULTS.deck),
      getSetting('cardBack', DEFAULTS.cardBack),
      getSetting('handedness', DEFAULTS.handedness),
      getSetting('highlightCard', DEFAULTS.highlightCard),
      getSetting('particles', DEFAULTS.particles),
      getSetting('cardEffects', DEFAULTS.cardEffects),
      getSetting('tableTexture', DEFAULTS.tableTexture),
      getSetting('boardFrame', DEFAULTS.boardFrame),
      getSetting('seenThemeItemIds', []),
      getSetting('seenAchievementIds', []),
      getSetting('themeModalTab', 'background'),
    ]);
    setActiveDeck(deck);
    set({ theme, interfaceTheme, deck, cardBack, handedness, highlightCard, particles, cardEffects, tableTexture, boardFrame, seenThemeItemIds, seenAchievementIds, themeModalTab, loaded: true });
  },

  /**
   * @param {string} theme
   */
  setTheme: (theme) => {
    set({ theme });
    setSetting('theme', theme);
    writeLS(LS_KEYS.theme, theme);
  },

  /**
   * @param {string} interfaceTheme  'classic' | 'dark' — the UI chrome look,
   *   independent of the board/Background theme.
   */
  setInterfaceTheme: (interfaceTheme) => {
    set({ interfaceTheme });
    setSetting('interfaceTheme', interfaceTheme);
    writeLS(LS_KEYS.interfaceTheme, interfaceTheme);
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
    writeLS(LS_KEYS.handedness, handedness);
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

  setCardEffects: (cardEffects) => {
    set({ cardEffects });
    setSetting('cardEffects', cardEffects);
  },

  setTableTexture: (tableTexture) => {
    set({ tableTexture });
    setSetting('tableTexture', tableTexture);
  },

  setBoardFrame: (boardFrame) => {
    set({ boardFrame });
    setSetting('boardFrame', boardFrame);
  },

  /**
   * Persist the last-selected Theme modal tab so re-opening restores it.
   * @param {string} tab  one of the ThemeModal TABS ids
   */
  setThemeModalTab: (tab) => {
    set({ themeModalTab: tab });
    setSetting('themeModalTab', tab);
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

  markAchievementsSeen: (ids) => {
    if (!ids || ids.length === 0) return;
    set((s) => {
      const next = Array.from(new Set([...s.seenAchievementIds, ...ids]));
      setSetting('seenAchievementIds', next);
      return { seenAchievementIds: next };
    });
  },

  clearAchievementsSeen: () => {
    set({ seenAchievementIds: [] });
    setSetting('seenAchievementIds', []);
  },
}));
