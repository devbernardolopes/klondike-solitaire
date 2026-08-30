// components/App.jsx
// Root component. Composes Toolbar + Board. Loads the classic + dark theme
// CSS and registers both deck renderers (side-effect imports).

import '../render/themes/classic.css';
import '../render/themes/dark.css';
// Side-effect imports register the deck renderers with the registry.
import '../render/deck/SpriteDeckRenderer.js';
import '../render/deck/ProceduralDeckRenderer.js';
import { useEffect } from 'react';
import Toolbar from './Toolbar.jsx';
import Board from './Board.jsx';
import WinModal from './WinModal.jsx';
import { useGameStore } from '../hooks/useGameStore.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';
import { useStatisticsStore } from '../hooks/useStatisticsStore.js';
import { useSeedStore } from '../hooks/useSeedStore.js';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { initUsedRandomSeeds } from '../db/usedRandomSeeds.js';
import { startSyncEngine } from '../sync/syncEngine.js';
import { pullRemoteProfile } from '../sync/pullProfile.js';
import { checkAuthRedirectResult } from '../lib/authRedirect.js';
import ConfirmModal from './ConfirmModal.jsx';
import { MotionDebugPanel } from '../render/animation/MotionDebugPanel.jsx';
import { useToastStore } from '../hooks/useToastStore.js';
import { initAchievementToastBridge } from '../toast/achievementToastBridge.js';
import ToastHost from './ToastHost.jsx';
import {
  ensureDeviceId,
  restoreSession,
  initSessionPersistence,
} from '../sync/sessionPersistence.js';

export default function App() {
  const theme = useSettingsStore((s) => s.theme);
  const interfaceTheme = useSettingsStore((s) => s.interfaceTheme);
  const deck = useSettingsStore((s) => s.deck);
  const handedness = useSettingsStore((s) => s.handedness);
  const highlightCard = useSettingsStore((s) => s.highlightCard);
  const particles = useSettingsStore((s) => s.particles);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setDeck = useSettingsStore((s) => s.setDeck);
  const setHandedness = useSettingsStore((s) => s.setHandedness);
  const setHighlightCard = useSettingsStore((s) => s.setHighlightCard);
  const setParticles = useSettingsStore((s) => s.setParticles);
  const init = useSettingsStore((s) => s.init);
  const initStats = useStatisticsStore((s) => s.init);
  const initSeeds = useSeedStore((s) => s.init);
  const state = useGameStore((s) => s.state);
  const linkConflict = useAuthStore((s) => s.linkConflict);

  useEffect(() => {
    let cleanupToastBridge = null;
    let cleanupSession = null;
    (async () => {
      await useAuthStore.getState().init();
      await checkAuthRedirectResult();
      // One-time cross-device pull for already-linked accounts (skipped for
      // anonymous — there's nothing on another device to fetch).
      if (!useAuthStore.getState().isAnonymous) {
        pullRemoteProfile().catch((e) => console.error('Startup profile pull failed', e));
      }
      startSyncEngine();
      init();
      initStats();
      initSeeds();
      await initUsedRandomSeeds();
      // Resolve the per-device id, then restore any in-progress session from
      // local Dexie (or Supabase for a linked account). Skip the initial deal
      // when a session was restored — this is a resume, not a fresh game.
      await ensureDeviceId();
      const restored = await restoreSession();
      if (!restored) {
        useGameStore.getState().initialDeal();
      }
      // Begin capturing session changes once the board is in its final state.
      cleanupSession = initSessionPersistence();
      useToastStore.getState().initConfig();
      // Subscribe the toast UI to achievement-unlock signals (next to the sync
      // engine that produces them); clean up on unmount.
      cleanupToastBridge = initAchievementToastBridge();
    })();
    return () => {
      if (cleanupToastBridge) cleanupToastBridge();
      if (cleanupSession) cleanupSession();
    };
  }, [init, initStats, initSeeds]);

  // Pull the linked account's latest progress from Supabase whenever the tab
  // regains focus — cross-device sync without a manual refresh.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && !useAuthStore.getState().isAnonymous) {
        pullRemoteProfile().catch((e) => console.error('Background profile pull failed', e));
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Pause/resume the play timer with tab focus. When the tab is hidden the clock
  // freezes (hidden time excluded); when it returns the clock resumes. The auto-
  // complete animation likewise just freezes and resumes (rAF pause + GSAP lag
  // smoothing), so the game never silently jumps to a win while unfocused.
  useEffect(() => {
    const onVisibility = () => {
      useStatsStore.getState().setFocused(!document.hidden);
    };
    useStatsStore.getState().setFocused(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Dismiss the transient "No hints available" banner whenever the user performs
  // any interaction other than (a) invoking the hint action or (b) a single
  // tap/click on empty screen. We listen at the document level in the capture
  // phase so the check runs before any per-element handler and we can precisely
  // carve out the two non-dismissing cases:
  //   - a click on the hint button (`[data-hint-button]`) keeps the banner;
  //   - a click that lands on neither a card, a pile, nor a button is "empty part
  //     of the screen" and also keeps the banner.
  // Everything else (a card tap, undo/redo/draw/recycle/auto-complete, toolbar
  // buttons, modal buttons) dismisses it immediately, even mid 3-second window.
  useEffect(() => {
    const onPointerDown = (e) => {
      const t = e.target;
      if (t.closest && t.closest('[data-hint-button]')) return;
      const onInteractive =
        (t.closest && t.closest('[data-card]')) ||
        (t.closest && t.closest('[data-pile]')) ||
        (t.closest && t.closest('button,[role="button"]'));
      if (!onInteractive) return;
      useUiStore.getState().dismissNoHintsBanner();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  return (
    <div
      className={`theme-${theme} ui-${interfaceTheme}`}
      style={{
        minHeight: '100%',
        background: 'var(--felt-color)',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Toolbar
        theme={theme}
        onThemeChange={setTheme}
        deck={deck}
        onDeckChange={setDeck}
        handedness={handedness}
        onHandednessChange={setHandedness}
        highlightCard={highlightCard}
        onHighlightCardChange={setHighlightCard}
        particles={particles}
        onParticlesChange={setParticles}
      />
      <Board />
      {import.meta.env.DEV && <MotionDebugPanel />}
      <WinModal />
      <ToastHost />
      <ConfirmModal
        open={!!linkConflict}
        title="Google account already linked"
        message="This Google account is already linked to a different player profile. Continuing will switch this device to that profile's data — this device's current progress (not yet linked to any account) will not be kept."
        confirmText="Switch to that profile"
        cancelText="Stay on this device"
        onConfirm={() => useAuthStore.getState().resolveLinkConflict(true)}
        onCancel={() => useAuthStore.getState().resolveLinkConflict(false)}
      />
    </div>
  );
}
