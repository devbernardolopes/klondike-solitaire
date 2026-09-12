// components/Toolbar.jsx
// New game, undo, theme/deck switchers. Stubs OK for switchers this pass.

import { useEffect, useCallback, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Undo2, Menu, Lightbulb, Coins as CoinsIcon, Heart } from 'lucide-react';
import { useGameStore } from '../hooks/useGameStore.js';
import { useFavoritesStore } from '../hooks/useFavoritesStore.js';
import { useUiStore, isAnyModalOpen, whenTransitionDone } from '../hooks/useUiStore.js';
import { Z } from '../utils/modalStack.js';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { usePlaybackStore } from '../hooks/usePlaybackStore.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';
import { isWon } from '../core/winDetection.js';
import NewGameModal from './NewGameModal.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import GameModeLabel from './GameModeLabel.jsx';
import SettingsModal from './SettingsModal.jsx';
import SeedInputModal from './SeedInputModal.jsx';
import DailyChallengeModal from './DailyChallengeModal.jsx';
import { formatTimeClock } from '../utils/formatTime.js';
import { visibleCoins } from './coinFlyDisplay.js';

const UNDO_HOLD_DELAY_MS = 400;
const UNDO_REPEAT_INTERVAL_MS = 200;

/**
 * Live elapsed game time. Derived from a fixed start/end timestamp (not from
 * accumulating interval ticks) and excluding hidden-tab spans via getElapsedMs,
 * so it reflects only actively-focused play. The display uses animation-frame
 * refreshes with conditional React updates — only re-rendering when the
 * displayed digit changes (centisecond when centisecondsOn, otherwise whole
 * second) — while a separate short interval enforces the time limit.
 *
 * The refresh cadence is driven by the `centisecondsOn` setting: when ON we
 * update on the 10 ms boundary (~100 Hz state updates); when OFF we update on
 * the 1 s boundary (~1 Hz). Disabling centiseconds therefore drops the HUD
 * re-render rate by ~100×.
 * @returns {string} "MM:SS.hh" or "MM:SS" (centiseconds hidden)
 */
function useElapsed() {
  const startTime = useStatsStore((s) => s.startTime);
  const endTime = useStatsStore((s) => s.endTime);
  const isOver = useStatsStore((s) => s.isOver);
  // Subscribe to the pause bookkeeping so the HUD re-renders on focus change.
  const pausedAt = useStatsStore((s) => s.pausedAt);
  const pausedAccumMs = useStatsStore((s) => s.pausedAccumMs);
  const centisecondsOn = useSettingsStore((s) => s.centisecondsOn);
  const [now, setNow] = useState(() => Date.now());
  const lastBucketRef = useRef(-1);
  useEffect(() => {
    if (startTime === null || endTime !== null || isOver) return undefined;

    // Bucket size: 10 ms (centiseconds visible) or 1000 ms (hidden). The
    // refresh loop only commits a React state update when the bucket changes,
    // so a 120 Hz display with centiseconds hidden still produces ≤1 state
    // update per second.
    const bucketMs = centisecondsOn ? 10 : 1000;
    lastBucketRef.current = -1;

    let frameId = null;
    const refreshDisplay = () => {
      const currentTime = Date.now();
      const bucket = Math.floor(currentTime / bucketMs);
      if (bucket !== lastBucketRef.current) {
        lastBucketRef.current = bucket;
        setNow(currentTime);
      }
      frameId = requestAnimationFrame(refreshDisplay);
    };
    frameId = requestAnimationFrame(refreshDisplay);

    // The 250 ms checkTimeLimit interval is INDEPENDENT of the display
    // cadence — the 30:00 game-over boundary must be enforced whether the
    // HUD shows hundredths or not, so it stays at its safety-oriented tick.
    const limitTimerId = setInterval(() => {
      useStatsStore.getState().checkTimeLimit();
    }, 250);

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      clearInterval(limitTimerId);
    };
  }, [startTime, endTime, isOver, centisecondsOn]);
  const elapsed = startTime === null ? 0 : useStatsStore.getState().getElapsedMs(now);
  return formatTimeClock(elapsed, { centiseconds: centisecondsOn });
}

/**
 * @param {object} props
 * @param {string} props.theme    active theme name
 * @param {(t: string) => void} props.onThemeChange
 * @param {string} props.deck     active deck/renderer name
 * @param {(d: string) => void} props.onDeckChange
 * @param {'left'|'right'} props.handedness  board pile arrangement
 * @param {(h: 'left'|'right') => void} props.onHandednessChange
 * @param {boolean} props.highlightCard  draw the focus outline on the focused card
 * @param {(v: boolean) => void} props.onHighlightCardChange
 * @param {boolean} props.particles  enable the foundation suit-burst effect
 * @param {(v: boolean) => void} props.onParticlesChange
 */
export default function Toolbar({ theme, onThemeChange, deck, onDeckChange, handedness, onHandednessChange, highlightCard, onHighlightCardChange, particles, onParticlesChange, bootstrapReady }) {
  const { t } = useTranslation();
  const dealNewGame = useGameStore((s) => s.dealNewGame);
  const dealWithSeed = useGameStore((s) => s.dealWithSeed);
  const replayGame = useGameStore((s) => s.replayGame);
  const undo = useGameStore((s) => s.undo);
  const showHints = useGameStore((s) => s.showHints);
  const canUndo = useGameStore((s) => s.canUndo());
  const autoCompleting = useGameStore((s) => s.autoCompleting);
  const playbackActive = useUiStore((s) => s.playbackActive);
  const won = useGameStore((s) => isWon(s.state));
  const isOver = useStatsStore((s) => s.isOver);
  const startTime = useStatsStore((s) => s.startTime);
  const canReplay = startTime !== null;

  const newGameDialogOpen = useUiStore((s) => s.newGameDialogOpen);
  const setNewGameDialogOpen = useUiStore((s) => s.setNewGameDialogOpen);
  const setDailyChallengeDialogOpen = useUiStore((s) => s.setDailyChallengeDialogOpen);
  const setDailyChallengeOrigin = useUiStore((s) => s.setDailyChallengeOrigin);
  const settingsDialogOpen = useUiStore((s) => s.settingsDialogOpen);
  const setSettingsDialogOpen = useUiStore((s) => s.setSettingsDialogOpen);
  const setHelpDialogOpen = useUiStore((s) => s.setHelpDialogOpen);
  const seedInputDialogOpen = useUiStore((s) => s.seedInputDialogOpen);
  const setSeedInputDialogOpen = useUiStore((s) => s.setSeedInputDialogOpen);
  const setAnnounce = useUiStore((s) => s.setAnnounce);
  const coins = useAuthStore((s) => s.coins);
  const coinFlight = useUiStore((s) => s.coinFlight);
  const profileReady = useAuthStore((s) => s.profileReady);
  const anyModalOpen = useUiStore(isAnyModalOpen);
  // A replayed win sets `won` from the board — never glow the New Game
  // button for it. Playback ends by user action, not by winning.
  const newGameNeedsAttention = !anyModalOpen && !autoCompleting && !playbackActive && (won || isOver);

  // Game session stats (moves / score) + live elapsed time for the HUD.
  const moves = useStatsStore((s) => s.moves);
  const score = useStatsStore((s) => s.score);
  // During playback the moves counter is untouched (always 0), so the moves
  // slot shows the replay position instead, in the identical value style.
  const playbackCursor = usePlaybackStore((s) => s.cursor);
  const playbackTotal = usePlaybackStore((s) => s.states.length);

  // HUD favorite toggle: reflects whether the currently-dealt game is
  // favorited. Toggling on favorites immediately; toggling off asks for
  // confirmation first (same confirm as the Favorites modal row toggle).
  const currentSeed = useGameStore((s) => s.replaySpec?.seed ?? null);
  const favorites = useFavoritesStore((s) => s.favorites);
  const isCurrentFavorite = currentSeed != null && favorites.some((f) => f.seed === currentSeed);
  const [unfavoriteConfirmOpen, setUnfavoriteConfirmOpen] = useState(false);
  const onFavoriteHudClick = useCallback(() => {
    if (playbackActive || currentSeed == null) return;
    if (useFavoritesStore.getState().isFavorite(currentSeed)) {
      setUnfavoriteConfirmOpen(true);
    } else {
      useFavoritesStore.getState().favoriteCurrent().catch(() => {});
    }
  }, [currentSeed, playbackActive]);
  const onConfirmHudUnfavorite = useCallback(async () => {
    setUnfavoriteConfirmOpen(false);
    const seed = useGameStore.getState().replaySpec?.seed ?? null;
    if (seed == null) return;
    try {
      await useFavoritesStore.getState().unfavorite(seed);
    } catch {}
  }, []);

  // The session locks (won, a hard limit hit, a winning auto-complete in
  // progress, or an active move playback) — disable undo/hint and surface the
  // Game Over dialog when a limit (not a win) ended the game.
  const locked = won || isOver || autoCompleting || playbackActive;

  // A short press is left to the native click handler so mouse clicks, touch
  // taps, and keyboard activation all remain one undo. Once the hold delay is
  // crossed, repeated undo calls own the interaction and the trailing click is
  // suppressed to avoid an extra undo.
  const undoHoldTimer = useRef(null);
  const undoRepeatTimer = useRef(null);
  const undoPointerId = useRef(null);
  const undoRepeating = useRef(false);
  const suppressUndoClick = useRef(false);
  const undoHoldActive = useRef(false);
  const clearUndoHold = useCallback(() => {
    undoHoldActive.current = false;
    if (undoHoldTimer.current !== null) {
      clearTimeout(undoHoldTimer.current);
      undoHoldTimer.current = null;
    }
    if (undoRepeatTimer.current !== null) {
      clearTimeout(undoRepeatTimer.current);
      undoRepeatTimer.current = null;
    }
    undoPointerId.current = null;
    undoRepeating.current = false;
  }, []);
  const repeatUndo = useCallback(async () => {
    if (!undoHoldActive.current) return;
    const current = useGameStore.getState();
    const currentStats = useStatsStore.getState();
    if (current.autoCompleting || isWon(current.state) || !current.canUndo() || currentStats.isOver) {
      clearUndoHold();
      return;
    }
    const { animatingCards, slidingCards, animatingLocs } = useUiStore.getState();
    if (animatingCards.size > 0 || slidingCards.size > 0 || animatingLocs.size > 0) {
      undoRepeatTimer.current = setTimeout(repeatUndo, 50);
      return;
    }
    const tid = undo();
    if (tid == null) {
      clearUndoHold();
      return;
    }
    try { await whenTransitionDone(tid); } catch {}
    if (!undoHoldActive.current) return;
    if (!useGameStore.getState().canUndo() || useStatsStore.getState().isOver) {
      clearUndoHold();
      return;
    }
    undoRepeatTimer.current = setTimeout(repeatUndo, UNDO_REPEAT_INTERVAL_MS);
  }, [clearUndoHold, undo]);
  const onUndoPointerDown = useCallback((e) => {
    if (e.isPrimary === false || (e.pointerType === 'mouse' && e.button !== 0)) return;
    clearUndoHold();
    undoHoldActive.current = true;
    undoPointerId.current = e.pointerId;
    undoRepeating.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    undoHoldTimer.current = setTimeout(() => {
      undoHoldTimer.current = null;
      if (!undoHoldActive.current || undoPointerId.current !== e.pointerId) return;
      undoRepeating.current = true;
      suppressUndoClick.current = true;
      repeatUndo();
    }, UNDO_HOLD_DELAY_MS);
  }, [clearUndoHold, repeatUndo]);
  const onUndoPointerEnd = useCallback((e) => {
    if (undoPointerId.current !== null && e.pointerId !== undoPointerId.current) return;
    clearUndoHold();
  }, [clearUndoHold]);
  const onUndoClick = useCallback((e) => {
    if (suppressUndoClick.current) {
      suppressUndoClick.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    undo();
  }, [undo]);
  useEffect(() => {
    const cancel = () => clearUndoHold();
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('blur', cancel);
      clearUndoHold();
    };
  }, [clearUndoHold]);

  // Stable modal callback identities. The live clock ticks re-render Toolbar
  // every 250ms while a game is in progress; if these handlers were inline
  // arrows their identity would change on every tick, re-firing each dialog's
  // focus-on-open effect (which steals focus to its default button) and
  // snapping shut any open <select> dropdown in the Settings dialog.
  const closeSettings = useCallback(() => {
    setSettingsDialogOpen(false);
    setHelpDialogOpen(false);
  }, [setSettingsDialogOpen, setHelpDialogOpen]);
  const closeNewGame = useCallback(() => setNewGameDialogOpen(false), [setNewGameDialogOpen]);

  // Shared guard: if a game is currently in progress, stash the requested deal/
  // replay action behind the "discard current game?" confirmation dialog
  // (which records a loss on confirm); otherwise run it immediately. Every new/
  // replacement-deal entry point routes through this so an in-progress game is
  // never silently discarded.
  const startDealOrConfirm = useCallback((action) => {
    if (useStatsStore.getState().isInProgress()) {
      useUiStore.getState().setPendingStartDeal(action);
      useUiStore.getState().setConfirmNewGameDialogOpen(true);
    } else {
      action();
    }
  }, []);

  const onReplay = useCallback(() => {
    if (useStatsStore.getState().startTime === null) return;
    startDealOrConfirm(() => {
      setNewGameDialogOpen(false);
      replayGame();
    });
  }, [startDealOrConfirm, setNewGameDialogOpen, replayGame]);
  const onWinningDeal = useCallback(() => {
    startDealOrConfirm(() => {
      setNewGameDialogOpen(false);
      dealNewGame('winning');
    });
  }, [startDealOrConfirm, setNewGameDialogOpen, dealNewGame]);
  const onRandomShuffle = useCallback(() => {
    startDealOrConfirm(() => {
      setNewGameDialogOpen(false);
      dealNewGame('random');
    });
  }, [startDealOrConfirm, setNewGameDialogOpen, dealNewGame]);
  const onDailyChallenge = useCallback(() => {
    setNewGameDialogOpen(false);
    setDailyChallengeOrigin('newgame');
    setDailyChallengeDialogOpen(true);
  }, [setNewGameDialogOpen, setDailyChallengeOrigin, setDailyChallengeDialogOpen]);
  const onSpecialEvents = useCallback(() => {
    setNewGameDialogOpen(false);
    useUiStore.getState().setSpecialEventsOrigin('newgame');
    useUiStore.getState().setSpecialEventsOpen(true);
  }, [setNewGameDialogOpen]);
  const onSeedConfirm = useCallback((seed) => {
    startDealOrConfirm(() => {
      setSeedInputDialogOpen(false);
      dealWithSeed(seed);
      setAnnounce(t('toolbar.announce.newGame', { seed }));
    });
  }, [startDealOrConfirm, setSeedInputDialogOpen, dealWithSeed, setAnnounce, t]);
  const onSeedCancel = useCallback(() => {
    setSeedInputDialogOpen(false);
  }, [setSeedInputDialogOpen]);

  const btn = {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.25)',
    background: 'rgba(255,255,255,0.1)',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 13,
  };

  // Floating action-button styling shared by the bottom-corner controls.
  const fab = {
    ...btn,
    position: 'fixed',
    bottom: 16,
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  };

  // Bottom-left cluster: [New Game] only (Main Menu lives top-right).
  // Each is fixed-bottom and ~40px wide with a 12px gap (FAB_GAP), matching the
  // Hint/Undo spacing on the bottom-right.
  const FAB_WIDTH = 40;
  const FAB_GAP = 12;
  const fabLeft = (slot) => 16 + slot * (FAB_WIDTH + FAB_GAP);

const hudLabelStyle = {
  color: '#fff',
  fontSize: 14,
  fontWeight: 700,
  userSelect: 'none',
};

const hudValueStyle = {
  color: '#fff',
  fontSize: 18,
  fontWeight: 700,
  userSelect: 'none',
  fontVariantNumeric: 'tabular-nums',
  display: 'inline-block',
  minWidth: '3ch',
  textAlign: 'center',
};

const hudColStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
};

/**
 * Live elapsed-time HUD cell. Isolated into its own component so the 250ms
 * tick that refreshes the clock only re-renders this node, not the whole
 * Toolbar (and, critically, not the dialog subtrees rendered alongside it).
 * @returns {JSX.Element}
 */
function ElapsedClock() {
  const { t } = useTranslation();
  const elapsed = useElapsed();
  return (
    <div style={hudColStyle}>
      <span style={hudLabelStyle}>{t('toolbar.time')}</span>
      <span style={hudValueStyle}>{elapsed}</span>
    </div>
  );
}

  return (
    <>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '8px clamp(8px, 2vw, 20px)',
          width: '100%',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 'clamp(14px, 4vw, 80px)',
            alignItems: 'flex-start',
            pointerEvents: 'none',
            position: 'relative',
          }}
        >
          {currentSeed != null && !playbackActive && (
            <button
              type="button"
              onClick={onFavoriteHudClick}
              aria-label={isCurrentFavorite ? t('favorites.unfavoriteAction') : t('favorites.favoriteAction')}
              title={isCurrentFavorite ? t('favorites.unfavoriteAction') : t('favorites.favoriteAction')}
              aria-pressed={isCurrentFavorite}
              style={{
                position: 'absolute',
                left: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'auto',
                background: 'none',
                border: 'none',
                padding: 8,
                cursor: 'pointer',
                color: isCurrentFavorite ? '#e5484d' : '#fff',
                opacity: isCurrentFavorite ? 1 : 0.85,
              }}
            >
              <Heart size={22} fill={isCurrentFavorite ? '#e5484d' : 'none'} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setSettingsDialogOpen(true)}
            aria-label={t('mainMenu.title')}
            title={t('mainMenu.title')}
            style={{
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'auto',
              background: 'none',
              border: 'none',
              padding: 8,
              cursor: 'pointer',
              color: '#fff',
              opacity: 0.85,
            }}
          >
            <Menu size={22} aria-hidden="true" />
          </button>
          <div style={{ ...hudColStyle, display: 'none' }}>
            <span style={hudLabelStyle}>{t('toolbar.score')}</span>
            <span style={hudValueStyle}>{score}</span>
          </div>
          {!playbackActive && <ElapsedClock />}
          <div style={hudColStyle}>
            <span style={hudLabelStyle}>{t('toolbar.moves')}</span>
            <span style={hudValueStyle} aria-live={playbackActive ? 'polite' : undefined}>
              {playbackActive ? `${playbackCursor} / ${Math.max(0, playbackTotal - 1)}` : moves}
            </span>
          </div>
          {/* During move playback the clock never ran and no coins were
              awarded, so both labels hide (moves stays: it reads the live
              session counter, untouched by the replay). */}
          {!playbackActive && (
            <div style={hudColStyle}>
              <span style={{ ...hudLabelStyle, display: 'flex', alignItems: 'center', gap: 4 }}>
                <CoinsIcon size={12} style={{ color: '#f0b429' }} />{t('toolbar.coins')}
              </span>
              <span data-coin-balance style={{ ...hudValueStyle, display: 'inline-block', visibility: profileReady ? 'visible' : 'hidden' }}>{visibleCoins({ coins, flight: coinFlight })}</span>
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          position: 'fixed',
          left: 16,
          bottom: 68,
          zIndex: 0,
          maxWidth: '60vw',
          pointerEvents: 'auto',
        }}
      >
        <GameModeLabel variant="hud" />
      </div>

      <button
        className={newGameNeedsAttention ? 'new-game-attention' : undefined}
        style={{ ...fab, left: fabLeft(0) }}
        aria-label={t('toolbar.newGame')}
        title={t('toolbar.newGame.title')}
        onClick={() => setNewGameDialogOpen(true)}
      >
        <Plus size={20} />
      </button>

       {/* Hidden entirely during move playback (not just disabled). */}
       {!playbackActive && (
         <button
           style={{ ...fab, right: 16 + FAB_WIDTH + FAB_GAP, opacity: locked ? 0.4 : 1 }}
           aria-label={t('toolbar.hint')}
           title={t('toolbar.hint')}
           data-hint-button
           disabled={locked}
           onClick={showHints}
         >
           <Lightbulb size={20} />
         </button>
       )}

       <button
        style={{ ...fab, right: 16, opacity: locked || !canUndo ? 0.4 : 1, touchAction: 'manipulation' }}
        aria-label={t('toolbar.undo')}
        title={t('toolbar.undo')}
        disabled={locked || !canUndo}
        onPointerDown={onUndoPointerDown}
        onPointerUp={onUndoPointerEnd}
        onPointerCancel={onUndoPointerEnd}
        onPointerLeave={onUndoPointerEnd}
        onLostPointerCapture={onUndoPointerEnd}
        onClick={onUndoClick}
      >
        <Undo2 size={20} />
      </button>

      <NewGameModal
        open={newGameDialogOpen}
        onReplay={onReplay}
        canReplay={canReplay}
        onWinningDeal={onWinningDeal}
        onRandomShuffle={onRandomShuffle}
        onDailyChallenge={onDailyChallenge}
        onSpecialEvents={onSpecialEvents}
        onDismiss={closeNewGame}
      />

      <DailyChallengeModal />

      <SeedInputModal
        open={seedInputDialogOpen}
        onConfirm={onSeedConfirm}
        onCancel={onSeedCancel}
      />

      <ConfirmModal
        open={unfavoriteConfirmOpen}
        title={t('favorites.unfavoriteTitle')}
        message={t('favorites.unfavoriteMessage')}
        confirmText={t('favorites.unfavoriteConfirm')}
        cancelText={t('favorites.unfavoriteCancel')}
        onConfirm={onConfirmHudUnfavorite}
        onCancel={() => setUnfavoriteConfirmOpen(false)}
        zIndex={3200}
        z={Z.GRANDCHILD}
      />

      <SettingsModal
        open={settingsDialogOpen}
        onClose={closeSettings}
        theme={theme}
        onThemeChange={onThemeChange}
        deck={deck}
        onDeckChange={onDeckChange}
        handedness={handedness}
        onHandednessChange={onHandednessChange}
        highlightCard={highlightCard}
        onHighlightCardChange={onHighlightCardChange}
        particles={particles}
        onParticlesChange={onParticlesChange}
        bootstrapReady={bootstrapReady}
      />
    </>
  );
}
