// components/App.jsx
// Root component. Composes Toolbar + Board. Loads the classic + dark theme
// CSS and registers both deck renderers (side-effect imports).

import '../render/themes/classic.css';
import '../render/themes/dark.css';
import '../render/themes/felts.css';
import { applyFeltTexture } from '../render/themes/feltTextures.js';
// Side-effect imports register the deck renderers with the registry.
import '../render/deck/ProceduralDeckRenderer.js';
import { useEffect, useState, useCallback } from 'react';
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
import { useTranslation } from 'react-i18next';
import { useToastStore } from '../hooks/useToastStore.js';
import { initAchievementToastBridge } from '../toast/achievementToastBridge.js';
import ToastHost from './ToastHost.jsx';
import SpecialEventsModal from './SpecialEventsModal.jsx';
import EventDetailModal from './EventDetailModal.jsx';
import { useSound } from '../hooks/useSound.js';
import { Z } from '../utils/modalStack.js';
import {
  ensureDeviceId,
  restoreSession,
  initSessionPersistence,
} from '../sync/sessionPersistence.js';
import { prefetch as prefetchSeeds } from '../repo/seedRepository.js';

export default function App() {
  const [bootstrapReady, setBootstrapReady] = useState(false);
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
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  useEffect(() => {
    try { document.documentElement.lang = language; } catch {}
  }, [language]);

  useEffect(() => {
    let cleanupToastBridge = null;
    let cleanupSession = null;
    (async () => {
      await useAuthStore.getState().init();
      await checkAuthRedirectResult();
      // One-time cross-device pull for already-linked accounts (skipped for
      // anonymous — there's nothing on another device to fetch).
      if (!useAuthStore.getState().isAnonymous) {
        await pullRemoteProfile().catch((e) => console.error('Startup profile pull failed', e));
      }
      startSyncEngine();
      init();
      initStats();
      initSeeds();
      await initUsedRandomSeeds();
      prefetchSeeds().catch(() => {});
      // Resolve the per-device id, then restore any in-progress session from
      // local Dexie (or Supabase for a linked account). Skip the initial deal
      // when a session was restored — this is a resume, not a fresh game.
      await ensureDeviceId();
      const restored = await restoreSession();
      if (!restored) useGameStore.getState().initialDeal();
      setBootstrapReady(true);
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

  const tableTexture = useSettingsStore((s) => s.tableTexture);
  const cardEffects = useSettingsStore((s) => s.cardEffects);
  const hoverLift = useSettingsStore((s) => s.hoverLift);
  useEffect(() => {
    try {
      const on = !!(cardEffects && hoverLift);
      if (!on) { document.documentElement.removeAttribute('data-hover-lift'); }
      else { document.documentElement.setAttribute('data-hover-lift', 'on'); }
    } catch {}
  }, [cardEffects, hoverLift]);
  useEffect(() => {
    try {
      if (!tableTexture) {
        document.documentElement.style.removeProperty('--felt-texture');
        return;
      }
      applyFeltTexture(theme);
    } catch {}
  }, [theme, tableTexture]);

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

  // --- Confirm modals (no-moves / game-over / discard-current-game) ---
  // These three ConfirmModals used to live inside Toolbar.jsx, which sits
  // inside a wrapper div with `position: relative; zIndex: 1` in App.jsx
  // (line 202). That wrapper creates a CSS stacking context, so the modals'
  // inline zIndex: Z.GRANDCHILD (3200) could not outpaint the
  // SpecialEventsModal / EventDetailModal mounted at the React root at
  // zIndex: 3100 — the stacking context trap. Moving the modals here, as
  // siblings of the other root-level modals, puts them in the same stacking
  // context, so their zIndex values actually compare.

  const noMovesDialogOpen = useUiStore((s) => s.noMovesDialogOpen);
  const setNoMovesDialogOpen = useUiStore((s) => s.setNoMovesDialogOpen);
  const gameOverDialogOpen = useUiStore((s) => s.gameOverDialogOpen);
  const setGameOverDialogOpen = useUiStore((s) => s.setGameOverDialogOpen);
  const confirmNewGameDialogOpen = useUiStore((s) => s.confirmNewGameDialogOpen);
  const setConfirmNewGameDialogOpen = useUiStore((s) => s.setConfirmNewGameDialogOpen);
  const setDailyChallengeDialogOpen = useUiStore((s) => s.setDailyChallengeDialogOpen);
  const setDailyChallengeOrigin = useUiStore((s) => s.setDailyChallengeOrigin);
  const overReason = useStatsStore((s) => s.overReason);
  const isOver = useStatsStore((s) => s.isOver);
  const lastNewGameMode = useUiStore((s) => s.lastNewGameMode);
  const currentGameKind = useUiStore((s) => s.currentGameKind);
  const dealNewGame = useGameStore((s) => s.dealNewGame);
  const replayGame = useGameStore((s) => s.replayGame);
  const undo = useGameStore((s) => s.undo);
  const { play } = useSound();

  // When the session hits a hard limit (time or moves), useStatsStore.freeze()
  // sets `isOver: true`; surface it as a confirm dialog here at the root.
  useEffect(() => {
    if (isOver) setGameOverDialogOpen(true);
  }, [isOver, setGameOverDialogOpen]);

  // Stable action identities for the three confirm modals. The hint-banner
  // pointerdown listener above re-fires every interaction; if these handlers
  // were inline arrows their identity would change on every render.
  const closeNoMoves = useCallback(() => setNoMovesDialogOpen(false), [setNoMovesDialogOpen]);
  const closeGameOver = useCallback(() => setGameOverDialogOpen(false), [setGameOverDialogOpen]);
  const onNoMovesConfirm = useCallback(() => {
    setNoMovesDialogOpen(false);
    dealNewGame(lastNewGameMode);
  }, [setNoMovesDialogOpen, dealNewGame, lastNewGameMode]);
  const onNoMovesCancel = useCallback(() => {
    setNoMovesDialogOpen(false);
    undo();
  }, [setNoMovesDialogOpen, undo]);
  const onNoMovesReplay = useCallback(() => {
    setNoMovesDialogOpen(false);
    replayGame();
    play('deal');
  }, [setNoMovesDialogOpen, replayGame, play]);
  // "Keep Going" just closes the dialog without undoing, leaving the board so
  // the user can recycle the stock (or make another move) if they choose to.
  const onNoMovesKeepGoing = useCallback(
    () => setNoMovesDialogOpen(false),
    [setNoMovesDialogOpen],
  );
  // When a daily challenge reaches a dead end, the primary button returns to the
  // Daily Challenge calendar WITHOUT advancing the day (advancing only happens
  // on a win, via the Win modal).
  const onNoMovesReturnDaily = useCallback(() => {
    setNoMovesDialogOpen(false);
    useUiStore.getState().setDailyChallengeOrigin('newgame');
    useUiStore.getState().setDailyChallengeDialogOpen(true);
  }, [setNoMovesDialogOpen]);
  const onConfirmNewGame = useCallback(() => {
    setConfirmNewGameDialogOpen(false);
    const action = useUiStore.getState().pendingStartDeal;
    useUiStore.getState().setPendingStartDeal(null);
    if (action) action();
  }, [setConfirmNewGameDialogOpen]);
  const onCancelNewGame = useCallback(() => {
    useUiStore.getState().setPendingStartDeal(null);
    setConfirmNewGameDialogOpen(false);
  }, [setConfirmNewGameDialogOpen]);

  return (
    <div
      className={`theme-${theme} ui-${interfaceTheme}`}
      style={{
        minHeight: '100%',
        background: 'var(--felt-color)',
        backgroundImage: 'var(--felt-texture, none), var(--felt-bg, none)',
        backgroundRepeat: 'repeat, no-repeat',
        backgroundSize: '256px 256px, cover',
        backgroundBlendMode: 'overlay, normal',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        isolation: 'isolate',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--felt-vignette, none)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', minHeight: '100%', flex: 1 }}>
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
          bootstrapReady={bootstrapReady}
        />
        <Board />
      </div>
      {import.meta.env.DEV && <MotionDebugPanel />}
      <WinModal />
      <SpecialEventsModal />
      <EventDetailModal />
      <ToastHost />
      <ConfirmModal
        open={!!linkConflict}
        title={t('mainMenu.account.switch.title')}
        message={t('mainMenu.account.switch.message')}
        confirmText={t('mainMenu.account.switch.confirm')}
        cancelText={t('mainMenu.account.switch.cancel')}
        onConfirm={() => useAuthStore.getState().resolveLinkConflict(true)}
        onCancel={() => useAuthStore.getState().resolveLinkConflict(false)}
      />
      <ConfirmModal
        open={noMovesDialogOpen}
        dismissable={false}
        title={t('toolbar.noMoves.title')}
        message={t('toolbar.noMoves.message')}
        confirmText={currentGameKind === 'daily' ? t('toolbar.noMoves.dailyConfirm') : t('toolbar.noMoves.confirm')}
        cancelText={t('toolbar.noMoves.cancel')}
        tertiaryText={t('toolbar.noMoves.tertiary')}
        onTertiary={onNoMovesReplay}
        quaternaryText={t('toolbar.noMoves.quaternary')}
        onQuaternary={onNoMovesKeepGoing}
        onConfirm={currentGameKind === 'daily' ? onNoMovesReturnDaily : onNoMovesConfirm}
        onCancel={onNoMovesCancel}
        onCloseIcon={onNoMovesKeepGoing}
      />
      <ConfirmModal
        open={gameOverDialogOpen}
        title={t('toolbar.gameOver.title')}
        message={
          overReason === 'moves'
            ? t('toolbar.gameOver.moves')
            : t('toolbar.gameOver.time')
        }
        confirmText={t('common.ok')}
        hideCancel
        dismissable={false}
        onConfirm={closeGameOver}
        onCancel={closeGameOver}
        onCloseIcon={closeGameOver}
      />
      <ConfirmModal
        open={confirmNewGameDialogOpen}
        title={t('toolbar.confirmNewGame.title')}
        zIndex={Z.GRANDCHILD}
        z={Z.GRANDCHILD}
        message={t('toolbar.confirmNewGame.message')}
        confirmText={t('confirm.confirm')}
        cancelText={t('confirm.cancel')}
        onConfirm={onConfirmNewGame}
        onCancel={onCancelNewGame}
      />
    </div>
  );
}
