// hooks/useSettingsStore.js
// Persisted UI settings (theme + active deck) backed by the Dexie `settings`
// table (see db/schema.js). Loads asynchronously on app start; writes through to
// Dexie on every change so selections survive reloads.
//
// Deck changes also drive the active renderer in deckRegistry so CardView can
// re-render faces from the right source.

import { create } from 'zustand';
import { setActiveDeck } from '../render/deck/deckRegistry.js';
import { getSetting, getSettings, setSetting } from '../db/schema.js';
import i18n, { detectSystemLocale, SUPPORTED, DEFAULT_LOCALE } from '../i18n/index.js';

// Hard cap on seen-ids sets as a defensive upper bound. The actual sizes are
// bounded by the achievement catalog (~32) and theme items catalog (~50), so
// this is a safety net against runaway growth from any future bug or migration.
const SEEN_IDS_CAP = 500;

/**
 * Convert a persisted array of seen ids back to a Set, defensively capping
 * its size to SEEN_IDS_CAP. Drops non-string entries and duplicates (the
 * Set constructor already dedupes, so the cap is applied after dedup).
 * @param {*} arr
 * @returns {Set<string>}
 */
function toCappedSet(arr) {
  if (!Array.isArray(arr)) return new Set();
  const out = new Set();
  for (const v of arr) {
    if (typeof v !== 'string' || out.size >= SEEN_IDS_CAP) continue;
    if (v.length === 0) continue;
    out.add(v);
  }
  return out;
}

const DEFAULTS = {
  language: DEFAULT_LOCALE,
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
  ghostEcho: true,
  ghostTrail: true,
  shimmer: true,
  uncover: true,
  winEnhanced: true,
  winCascade: true,
  hoverGlow: true,
  cardShake: true,
  centisecondsOn: true,
};

// Synchronous mirrors of the settings that affect first paint (theme + board
// layout). IndexedDB/Dexie is async and cannot be read before React paints, so
// we also persist these to localStorage on every change and seed the store's
// initial state from there. This prevents the classic flash-of-default-theme
// (or wrong handedness) on reload/refresh: the store already holds the saved
// value at first render, before the async Dexie init() resolves.
const LS_KEYS = {
  language: 'klondike:language',
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
  ghostEcho: 'klondike:ghostEcho',
  ghostTrail: 'klondike:ghostTrail',
  shimmer: 'klondike:shimmer',
  uncover: 'klondike:uncover',
  winEnhanced: 'klondike:winEnhanced',
  winCascade: 'klondike:winCascade',
  hoverGlow: 'klondike:hoverGlow',
  cardShake: 'klondike:cardShake',
  centisecondsOn: 'klondike:centisecondsOn',
};

function readLanguageLS() {
  try {
    const v = localStorage.getItem(LS_KEYS.language);
    if (v && SUPPORTED.includes(v)) return v;
    if (v != null) return DEFAULT_LOCALE;
    return detectSystemLocale();
  } catch {
    return DEFAULT_LOCALE;
  }
}

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
  language: readLanguageLS(),
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
  ghostEcho: readLS(LS_KEYS.ghostEcho, DEFAULTS.ghostEcho),
  ghostTrail: readLS(LS_KEYS.ghostTrail, DEFAULTS.ghostTrail),
  shimmer: readLS(LS_KEYS.shimmer, DEFAULTS.shimmer),
  uncover: readLS(LS_KEYS.uncover, DEFAULTS.uncover),
  winEnhanced: readLS(LS_KEYS.winEnhanced, DEFAULTS.winEnhanced),
  winCascade: readLS(LS_KEYS.winCascade, DEFAULTS.winCascade),
  hoverGlow: readLS(LS_KEYS.hoverGlow, DEFAULTS.hoverGlow),
  cardShake: readLS(LS_KEYS.cardShake, DEFAULTS.cardShake),
  centisecondsOn: readLS(LS_KEYS.centisecondsOn, DEFAULTS.centisecondsOn),
  seenThemeItemIds: new Set(),
  seenAchievementIds: new Set(),
  themeModalTab: 'interface',
  loaded: false,

  /**
   * Load persisted settings from Dexie. Safe to call once on mount; missing
   * keys fall back to DEFAULTS. Activates the loaded (or default) deck.
   */
  init: async () => {
    // Single bulkGet for all 21 settings → 1 IndexedDB transaction instead of
    // 21 individual getSetting() calls. Per-key defaults via the fallbackMap.
    const SETTING_KEYS = [
      'language', 'theme', 'interfaceTheme', 'deck', 'cardBack', 'handedness',
      'highlightCard', 'particles', 'cardEffects', 'tableTexture', 'boardFrame',
      'bounce', 'ghostEcho', 'ghostTrail', 'shimmer', 'uncover', 'winEnhanced', 'winCascade',
      'hoverGlow', 'cardShake', 'centisecondsOn', 'seenThemeItemIds', 'seenAchievementIds', 'themeModalTab',
    ];
    const SETTING_DEFAULTS = {
      theme: DEFAULTS.theme,
      interfaceTheme: DEFAULTS.interfaceTheme,
      deck: DEFAULTS.deck,
      cardBack: DEFAULTS.cardBack,
      handedness: DEFAULTS.handedness,
      highlightCard: DEFAULTS.highlightCard,
      particles: DEFAULTS.particles,
      cardEffects: DEFAULTS.cardEffects,
      tableTexture: DEFAULTS.tableTexture,
      boardFrame: DEFAULTS.boardFrame,
      bounce: DEFAULTS.bounce,
      ghostEcho: DEFAULTS.ghostEcho,
      ghostTrail: DEFAULTS.ghostTrail,
      shimmer: DEFAULTS.shimmer,
      uncover: DEFAULTS.uncover,
      winEnhanced: DEFAULTS.winEnhanced,
      winCascade: DEFAULTS.winCascade,
      hoverGlow: DEFAULTS.hoverGlow,
      cardShake: DEFAULTS.cardShake,
      centisecondsOn: DEFAULTS.centisecondsOn,
      seenThemeItemIds: [],
      seenAchievementIds: [],
      themeModalTab: 'background',
    };
    const [language, theme, interfaceTheme, deck, cardBack, handedness, highlightCard, particles, cardEffects, tableTexture, boardFrame, bounce, ghostEcho, ghostTrail, shimmer, uncover, winEnhanced, winCascade, hoverGlow, cardShake, centisecondsOn, seenThemeItemIdsArr, seenAchievementIdsArr, themeModalTab] = await getSettings(SETTING_KEYS, SETTING_DEFAULTS);
    // Use the LS read for language as a last-resort fallback for the language
    // key (the per-key default above is a static DEFAULT_LOCALE; the LS version
    // may have detected the system locale on a previous session).
    const resolvedLanguage = language ?? readLanguageLS();
    const normalizedLang = SUPPORTED.includes(resolvedLanguage) ? resolvedLanguage : DEFAULT_LOCALE;
    setActiveDeck(deck);
    // Re-hydrate persisted seen-id arrays back into Sets (Sets are not
    // serializable through Dexie/JSON, so we always persist as arrays).
    const seenThemeIds = toCappedSet(seenThemeItemIdsArr);
    const seenAchievementIds = toCappedSet(seenAchievementIdsArr);
    try {
      const toBackfill = [
        ['language', normalizedLang],
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
        ['ghostEcho', ghostEcho],
        ['ghostTrail', ghostTrail],
        ['shimmer', shimmer],
        ['uncover', uncover],
        ['winEnhanced', winEnhanced],
        ['winCascade', winCascade],
        ['hoverGlow', hoverGlow],
        ['cardShake', cardShake],
        ['centisecondsOn', centisecondsOn],
      ];
      // Unconditional write: the in-memory value is the source of truth
      // (either just loaded from Dexie or the in-code DEFAULTS). Skipping
      // the prior getItem() check removes 18 redundant localStorage reads
      // on every app start.
      for (const [k, v] of toBackfill) {
        const lsKey = LS_KEYS[k];
        if (!lsKey) continue;
        try {
          localStorage.setItem(lsKey, String(v));
        } catch {}
      }
    } catch {}
    try {
      if (i18n.language !== normalizedLang) await i18n.changeLanguage(normalizedLang);
      try { document.documentElement.lang = normalizedLang; } catch {}
    } catch {}
    set({ language: normalizedLang, theme, interfaceTheme, deck, cardBack, handedness, highlightCard, particles, cardEffects, tableTexture, boardFrame, bounce, ghostEcho, ghostTrail, shimmer, uncover, winEnhanced, winCascade, hoverGlow, cardShake, centisecondsOn, seenThemeItemIds: seenThemeIds, seenAchievementIds: seenAchievementIds, themeModalTab, loaded: true });
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

  setGhostEcho: (ghostEcho) => {
    set({ ghostEcho });
    setSetting('ghostEcho', ghostEcho);
    writeLS(LS_KEYS.ghostEcho, ghostEcho);
  },

  setGhostTrail: (ghostTrail) => {
    set({ ghostTrail });
    setSetting('ghostTrail', ghostTrail);
    writeLS(LS_KEYS.ghostTrail, ghostTrail);
  },
  setLanguage: (language) => {
    const v = SUPPORTED.includes(language) ? language : DEFAULT_LOCALE;
    set({ language: v });
    setSetting('language', v);
    writeLS(LS_KEYS.language, v);
    try {
      if (i18n.language !== v) i18n.changeLanguage(v);
      document.documentElement.lang = v;
    } catch {}
  },
  setShimmer: (shimmer) => { set({ shimmer }); setSetting('shimmer', shimmer); writeLS(LS_KEYS.shimmer, shimmer); },
  setUncover: (uncover) => { set({ uncover }); setSetting('uncover', uncover); writeLS(LS_KEYS.uncover, uncover); },
  setWinEnhanced: (winEnhanced) => { set({ winEnhanced }); setSetting('winEnhanced', winEnhanced); writeLS(LS_KEYS.winEnhanced, winEnhanced); },
  setWinCascade: (winCascade) => { set({ winCascade }); setSetting('winCascade', winCascade); writeLS(LS_KEYS.winCascade, winCascade); },
  setHoverGlow: (hoverGlow) => { set({ hoverGlow }); setSetting('hoverGlow', hoverGlow); writeLS(LS_KEYS.hoverGlow, hoverGlow); },
  setCardShake: (cardShake) => { set({ cardShake }); setSetting('cardShake', cardShake); writeLS(LS_KEYS.cardShake, cardShake); },
  setCentisecondsOn: (centisecondsOn) => { set({ centisecondsOn }); setSetting('centisecondsOn', centisecondsOn); writeLS(LS_KEYS.centisecondsOn, centisecondsOn); },

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
   * badge stops showing. Merges with the existing Set and persists to Dexie
   * (as an array, since Sets are not JSON-serializable). Hard-capped at
   * SEEN_IDS_CAP to prevent unbounded growth.
   * @param {string[]} ids
   */
  markThemeItemsSeen: (ids) => {
    if (!ids || ids.length === 0) return;
    set((s) => {
      const next = new Set(s.seenThemeItemIds);
      for (const id of ids) {
        if (typeof id !== 'string' || id.length === 0) continue;
        if (next.size >= SEEN_IDS_CAP) break;
        next.add(id);
      }
      if (next.size === s.seenThemeItemIds.size) return s;
      setSetting('seenThemeItemIds', Array.from(next));
      return { seenThemeItemIds: next };
    });
  },

  markAchievementsSeen: (ids) => {
    if (!ids || ids.length === 0) return;
    set((s) => {
      const next = new Set(s.seenAchievementIds);
      for (const id of ids) {
        if (typeof id !== 'string' || id.length === 0) continue;
        if (next.size >= SEEN_IDS_CAP) break;
        next.add(id);
      }
      if (next.size === s.seenAchievementIds.size) return s;
      setSetting('seenAchievementIds', Array.from(next));
      return { seenAchievementIds: next };
    });
  },

  clearAchievementsSeen: () => {
    set({ seenAchievementIds: new Set() });
    setSetting('seenAchievementIds', []);
  },
}));
