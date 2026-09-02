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
  bounce: true,
  ghostTrail: true,
  shimmer: true,
  uncover: true,
  winEnhanced: true,
  winCascade: true,
  hoverGlow: true,
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
  deck: 'klondike:deck',
  cardBack: 'klondike:cardBack',
  highlightCard: 'klondike:highlightCard',
  particles: 'klondike:particles',
  cardEffects: 'klondike:cardEffects',
  tableTexture: 'klondike:tableTexture',
  boardFrame: 'klondike:boardFrame',
  bounce: 'klondike:bounce',
  ghostTrail: 'klondike:ghostTrail',
  shimmer: 'klondike:shimmer',
  uncover: 'klondike:uncover',
  winEnhanced: 'klondike:winEnhanced',
  winCascade: 'klondike:winCascade',
  hoverGlow: 'klondike:hoverGlow',
};

function readLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v == null) return fallback;
    if (typeof fallback === 'boolean') {
      if (v === 'true') return true;
      if (v === 'false') return false;
      return fallback;
    }
    return v;
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage may be unavailable (private mode); Dexie remains the source of truth */
  }
}

try {
  const lsDeck = readLS(LS_KEYS.deck, DEFAULTS.deck);
  if (lsDeck !== DEFAULTS.deck) setActiveDeck(lsDeck);
} catch {}

export const useSettingsStore = create((set, get) => ({
  theme: readLS(LS_KEYS.theme, DEFAULTS.theme),
  interfaceTheme: readLS(LS_KEYS.interfaceTheme, DEFAULTS.interfaceTheme),
  deck: readLS(LS_KEYS.deck, DEFAULTS.deck),
  cardBack: readLS(LS_KEYS.cardBack, DEFAULTS.cardBack),
  handedness: readLS(LS_KEYS.handedness, DEFAULTS.handedness),
  highlightCard: readLS(LS_KEYS.highlightCard, DEFAULTS.highlightCard),
  particles: readLS(LS_KEYS.particles, DEFAULTS.particles),
  cardEffects: readLS(LS_KEYS.cardEffects, DEFAULTS.cardEffects),
  tableTexture: readLS(LS_KEYS.tableTexture, DEFAULTS.tableTexture),
  boardFrame: readLS(LS_KEYS.boardFrame, DEFAULTS.boardFrame),
  bounce: readLS(LS_KEYS.bounce, DEFAULTS.bounce),
  ghostTrail: readLS(LS_KEYS.ghostTrail, DEFAULTS.ghostTrail),
  shimmer: readLS(LS_KEYS.shimmer, DEFAULTS.shimmer),
  uncover: readLS(LS_KEYS.uncover, DEFAULTS.uncover),
  winEnhanced: readLS(LS_KEYS.winEnhanced, DEFAULTS.winEnhanced),
  winCascade: readLS(LS_KEYS.winCascade, DEFAULTS.winCascade),
  hoverGlow: readLS(LS_KEYS.hoverGlow, DEFAULTS.hoverGlow),
  seenThemeItemIds: [],
  seenAchievementIds: [],
  themeModalTab: 'interface',
  loaded: false,

  /**
   * Load persisted settings from Dexie. Safe to call once on mount; missing
   * keys fall back to DEFAULTS. Activates the loaded (or default) deck.
   */
  init: async () => {
    const [theme, interfaceTheme, deck, cardBack, handedness, highlightCard, particles, cardEffects, tableTexture, boardFrame, bounce, ghostTrail, shimmer, uncover, winEnhanced, winCascade, hoverGlow, seenThemeItemIds, seenAchievementIds, themeModalTab] = await Promise.all([
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
      getSetting('bounce', DEFAULTS.bounce),
      getSetting('ghostTrail', DEFAULTS.ghostTrail),
      getSetting('shimmer', DEFAULTS.shimmer),
      getSetting('uncover', DEFAULTS.uncover),
      getSetting('winEnhanced', DEFAULTS.winEnhanced),
      getSetting('winCascade', DEFAULTS.winCascade),
      getSetting('hoverGlow', DEFAULTS.hoverGlow),
      getSetting('seenThemeItemIds', []),
      getSetting('seenAchievementIds', []),
      getSetting('themeModalTab', 'background'),
    ]);
    setActiveDeck(deck);
    try {
      const toBackfill = [
        ['theme', theme],
        ['interfaceTheme', interfaceTheme],
        ['deck', deck],
        ['cardBack', cardBack],
        ['handedness', handedness],
        ['highlightCard', highlightCard],
        ['particles', particles],
        ['cardEffects', cardEffects],
        ['tableTexture', tableTexture],
        ['boardFrame', boardFrame],
        ['bounce', bounce],
        ['ghostTrail', ghostTrail],
        ['shimmer', shimmer],
        ['uncover', uncover],
        ['winEnhanced', winEnhanced],
        ['winCascade', winCascade],
        ['hoverGlow', hoverGlow],
      ];
      for (const [k, v] of toBackfill) {
        const lsKey = LS_KEYS[k];
        if (!lsKey) continue;
        try {
          if (localStorage.getItem(lsKey) == null) writeLS(lsKey, v);
        } catch {}
      }
    } catch {}
    set({ theme, interfaceTheme, deck, cardBack, handedness, highlightCard, particles, cardEffects, tableTexture, boardFrame, bounce, ghostTrail, shimmer, uncover, winEnhanced, winCascade, hoverGlow, seenThemeItemIds, seenAchievementIds, themeModalTab, loaded: true });
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
    writeLS(LS_KEYS.deck, deck);
  },

  /**
   * @param {string} cardBack  'default' or a cardBackRegistry key
   */
  setCardBack: (cardBack) => {
    set({ cardBack });
    setSetting('cardBack', cardBack);
    writeLS(LS_KEYS.cardBack, cardBack);
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
    writeLS(LS_KEYS.highlightCard, highlightCard);
  },

  /**
   * @param {boolean} particles  enable the foundation suit-burst particle effect
   */
  setParticles: (particles) => {
    set({ particles });
    setSetting('particles', particles);
    writeLS(LS_KEYS.particles, particles);
  },

  setCardEffects: (cardEffects) => {
    set({ cardEffects });
    setSetting('cardEffects', cardEffects);
    writeLS(LS_KEYS.cardEffects, cardEffects);
  },

  setTableTexture: (tableTexture) => {
    set({ tableTexture });
    setSetting('tableTexture', tableTexture);
    writeLS(LS_KEYS.tableTexture, tableTexture);
  },

  setBoardFrame: (boardFrame) => {
    set({ boardFrame });
    setSetting('boardFrame', boardFrame);
    writeLS(LS_KEYS.boardFrame, boardFrame);
  },

  setBounce: (bounce) => {
    set({ bounce });
    setSetting('bounce', bounce);
    writeLS(LS_KEYS.bounce, bounce);
  },

  setGhostTrail: (ghostTrail) => {
    set({ ghostTrail });
    setSetting('ghostTrail', ghostTrail);
    writeLS(LS_KEYS.ghostTrail, ghostTrail);
  },
  setShimmer: (shimmer) => { set({ shimmer }); setSetting('shimmer', shimmer); writeLS(LS_KEYS.shimmer, shimmer); },
  setUncover: (uncover) => { set({ uncover }); setSetting('uncover', uncover); writeLS(LS_KEYS.uncover, uncover); },
  setWinEnhanced: (winEnhanced) => { set({ winEnhanced }); setSetting('winEnhanced', winEnhanced); writeLS(LS_KEYS.winEnhanced, winEnhanced); },
  setWinCascade: (winCascade) => { set({ winCascade }); setSetting('winCascade', winCascade); writeLS(LS_KEYS.winCascade, winCascade); },
  setHoverGlow: (hoverGlow) => { set({ hoverGlow }); setSetting('hoverGlow', hoverGlow); writeLS(LS_KEYS.hoverGlow, hoverGlow); },

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
