// components/Toolbar.jsx
// New game, undo, theme/deck switchers. Stubs OK for switchers this pass.

import { useEffect, useCallback, useState, useRef } from 'react';
import { Plus, Undo2, Menu, Lightbulb, Coins as CoinsIcon } from 'lucide-react';
import { useGameStore } from '../hooks/useGameStore.js';
import { useUiStore, isAnyModalOpen } from '../hooks/useUiStore.js';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { useSound } from '../hooks/useSound.js';
import { isWon } from '../core/winDetection.js';
import ConfirmModal from './ConfirmModal.jsx';
import NewGameModal from './NewGameModal.jsx';
import SettingsModal from './SettingsModal.jsx';
import SeedInputModal from './SeedInputModal.jsx';
import DailyChallengeModal from './DailyChallengeModal.jsx';
import { formatTime } from '../utils/formatTime.js';
import { Z } from '../utils/modalStack.js';

const UNDO_HOLD_DELAY_MS = 400;
const UNDO_REPEAT_INTERVAL_MS = 200;

/**
 * Live elapsed game time. Derived from a fixed start/end timestamp (not from
 * accumulating interval ticks) and excluding hidden-tab spans via getElapsedMs,
 * so it reflects only actively-focused play. A short interval only exists to
 * refresh the displayed value and enforce the time limit.
 * @returns {string} "MM:SS"
 */
function useElapsed() {
  const startTime = useStatsStore((s) => s.startTime);
  const endTime = useStatsStore((s) => s.endTime);
  // Subscribe to the pause bookkeeping so the HUD re-renders on focus change.
  const pausedAt = useStatsStore((s) => s.pausedAt);
  const pausedAccumMs = useStatsStore((s) => s.pausedAccumMs);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startTime === null) return undefined;
    const id = setInterval(() => {
      setNow(Date.now());
      useStatsStore.getState().checkTimeLimit();
    }, 250);
    return () => clearInterval(id);
  }, [startTime]);
  const elapsed = startTime === null ? 0 : useStatsStore.getState().getElapsedMs(now);
  return formatTime(elapsed);
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
  const dealNewGame = useGameStore((s) => s.dealNewGame);
  const dealWithSeed = useGameStore((s) => s.dealWithSeed);
  const replayGame = useGameStore((s) => s.replayGame);
  const undo = useGameStore((s) => s.undo);
  const showHints = useGameStore((s) => s.showHints);
  const canUndo = useGameStore((s) => s.canUndo());
  const autoCompleting = useGameStore((s) => s.autoCompleting);
  const won = useGameStore((s) => isWon(s.state));
  const isOver = useStatsStore((s) => s.isOver);
  const startTime = useStatsStore((s) => s.startTime);
  const overReason = useStatsStore((s) => s.overReason);
  const canReplay = startTime !== null;
  const { play } = useSound();

  const newGameDialogOpen = useUiStore((s) => s.newGameDialogOpen);
  const setNewGameDialogOpen = useUiStore((s) => s.setNewGameDialogOpen);
  const lastNewGameMode = useUiStore((s) => s.lastNewGameMode);
  const currentGameKind = useUiStore((s) => s.currentGameKind);
  const currentDailyDate = useUiStore((s) => s.currentDailyDate);
  const setDailyChallengeDialogOpen = useUiStore((s) => s.setDailyChallengeDialogOpen);
  const setDailyChallengeOrigin = useUiStore((s) => s.setDailyChallengeOrigin);
  const noMovesDialogOpen = useUiStore((s) => s.noMovesDialogOpen);
  const setNoMovesDialogOpen = useUiStore((s) => s.setNoMovesDialogOpen);
  const settingsDialogOpen = useUiStore((s) => s.settingsDialogOpen);
  const setSettingsDialogOpen = useUiStore((s) => s.setSettingsDialogOpen);
  const setHelpDialogOpen = useUiStore((s) => s.setHelpDialogOpen);
  const seedInputDialogOpen = useUiStore((s) => s.seedInputDialogOpen);
  const setSeedInputDialogOpen = useUiStore((s) => s.setSeedInputDialogOpen);
  const setAnnounce = useUiStore((s) => s.setAnnounce);
  const coins = useAuthStore((s) => s.coins);
  const profileReady = useAuthStore((s) => s.profileReady);
  const gameOverDialogOpen = useUiStore((s) => s.gameOverDialogOpen);
  const setGameOverDialogOpen = useUiStore((s) => s.setGameOverDialogOpen);
  const confirmNewGameDialogOpen = useUiStore((s) => s.confirmNewGameDialogOpen);
  const setConfirmNewGameDialogOpen = useUiStore((s) => s.setConfirmNewGameDialogOpen);
  const anyModalOpen = useUiStore(isAnyModalOpen);
  const newGameNeedsAttention = !anyModalOpen && !autoCompleting && (won || isOver);

  // Game session stats (moves / score) + live elapsed time for the HUD.
  const gameState = useGameStore((s) => s.state);
  const moves = useStatsStore((s) => s.moves);
  const score = useStatsStore((s) => s.score);

  // The session locks (won, a hard limit hit, or a winning auto-complete in
  // progress) — disable undo/hint and surface the Game Over dialog when a limit
  // (not a win) ended the game.
  const locked = won || isOver || autoCompleting;

  // A short press is left to the native click handler so mouse clicks, touch
  // taps, and keyboard activation all remain one undo. Once the hold delay is
  // crossed, repeated undo calls own the interaction and the trailing click is
  // suppressed to avoid an extra undo.
  const undoHoldTimer = useRef(null);
  const undoRepeatTimer = useRef(null);
  const undoPointerId = useRef(null);
  const undoRepeating = useRef(false);
  const suppressUndoClick = useRef(false);
  const clearUndoHold = useCallback(() => {
    if (undoHoldTimer.current !== null) {
      clearTimeout(undoHoldTimer.current);
      undoHoldTimer.current = null;
    }
    if (undoRepeatTimer.current !== null) {
      clearInterval(undoRepeatTimer.current);
      undoRepeatTimer.current = null;
    }
    undoPointerId.current = null;
    undoRepeating.current = false;
  }, []);
  const repeatUndo = useCallback(() => {
    const current = useGameStore.getState();
    const currentStats = useStatsStore.getState();
    if (current.autoCompleting || isWon(current.state) || !current.canUndo() || currentStats.isOver) {
      clearUndoHold();
      return;
    }
    undo();
  }, [clearUndoHold, undo]);
  const onUndoPointerDown = useCallback((e) => {
    if (e.isPrimary === false || (e.pointerType === 'mouse' && e.button !== 0)) return;
    clearUndoHold();
    undoPointerId.current = e.pointerId;
    undoRepeating.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    undoHoldTimer.current = setTimeout(() => {
      undoHoldTimer.current = null;
      if (undoPointerId.current !== e.pointerId) return;
      undoRepeating.current = true;
      suppressUndoClick.current = true;
      repeatUndo();
      if (undoPointerId.current === e.pointerId) {
        undoRepeatTimer.current = setInterval(repeatUndo, UNDO_REPEAT_INTERVAL_MS);
      }
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
  useEffect(() => {
    if (isOver) setGameOverDialogOpen(true);
  }, [isOver, setGameOverDialogOpen]);

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
      play('deal');
    });
  }, [startDealOrConfirm, setNewGameDialogOpen, replayGame, play]);
  const onWinningDeal = useCallback(() => {
    startDealOrConfirm(() => {
      setNewGameDialogOpen(false);
      dealNewGame('winning');
      play('deal');
    });
  }, [startDealOrConfirm, setNewGameDialogOpen, dealNewGame, play]);
  const onRandomShuffle = useCallback(() => {
    startDealOrConfirm(() => {
      setNewGameDialogOpen(false);
      dealNewGame('random');
      play('deal');
    });
  }, [startDealOrConfirm, setNewGameDialogOpen, dealNewGame, play]);
  const onDailyChallenge = useCallback(() => {
    setNewGameDialogOpen(false);
    setDailyChallengeOrigin('newgame');
    setDailyChallengeDialogOpen(true);
  }, [setNewGameDialogOpen, setDailyChallengeOrigin, setDailyChallengeDialogOpen]);
  const onSpecialEvents = useCallback(() => {
    setNewGameDialogOpen(false);
    useUiStore.getState().setSpecialEventsOpen(true);
  }, [setNewGameDialogOpen]);
  const onSeedConfirm = useCallback((seed) => {
    startDealOrConfirm(() => {
      setSeedInputDialogOpen(false);
      dealWithSeed(seed);
      play('deal');
      setAnnounce(`New game: seed ${seed}`);
    });
  }, [startDealOrConfirm, setSeedInputDialogOpen, dealWithSeed, play, setAnnounce]);
  const onSeedCancel = useCallback(() => {
    setSeedInputDialogOpen(false);
  }, [setSeedInputDialogOpen]);

  // Double-click / double-tap the top-left seed label to open the "Enter Seed"
  // dialog. A pointer-based detector (mirroring Board's double-tap logic) makes
  // touch taps work too, since browsers don't synthesize dblclick for touch.
  const SEED_LABEL_DOUBLE_MS = 300;
  const SEED_LABEL_DOUBLE_DIST = 24;
  const lastLabelTap = useRef(null);
  const onLabelActivate = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    const now = Date.now();
    const tap = { x: e.clientX ?? 0, y: e.clientY ?? 0, t: now };
    const prev = lastLabelTap.current;
    lastLabelTap.current = tap;
    if (
      prev &&
      now - prev.t < SEED_LABEL_DOUBLE_MS &&
      Math.hypot(tap.x - prev.x, tap.y - prev.y) < SEED_LABEL_DOUBLE_DIST
    ) {
      lastLabelTap.current = null;
      setSeedInputDialogOpen(true);
    }
  }, [setSeedInputDialogOpen]);
  const closeNoMoves = useCallback(() => setNoMovesDialogOpen(false), [setNoMovesDialogOpen]);
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
  const closeGameOver = useCallback(() => setGameOverDialogOpen(false), [setGameOverDialogOpen]);
  const onConfirmNewGame = useCallback(() => {
    setConfirmNewGameDialogOpen(false);
    const action = useUiStore.getState().pendingStartDeal;
    useUiStore.getState().setPendingStartDeal(null);
    if (action) action();
  }, [setConfirmNewGameDialogOpen]);

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

  // Bottom-left cluster, left-to-right: [Main Menu] [New Game].
  // Each is fixed-bottom and ~40px wide with a 12px gap (FAB_GAP), matching the
  // Hint/Undo spacing on the bottom-right.
  const FAB_WIDTH = 40;
  const FAB_GAP = 12;
  const fabLeft = (slot) => 16 + slot * (FAB_WIDTH + FAB_GAP);

const hudLabelStyle = {
  color: '#fff',
  fontSize: 16,
  fontWeight: 700,
  userSelect: 'none',
};

const hudValueStyle = {
  color: '#fff',
  fontSize: 22,
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
  const elapsed = useElapsed();
  return (
    <div style={hudColStyle}>
      <span style={hudLabelStyle}>Time</span>
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
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            role="button"
            tabIndex={0}
            title="Double-click to enter a specific seed"
            onDoubleClick={onLabelActivate}
            onPointerUp={onLabelActivate}
            onKeyDown={onLabelActivate}
            style={{
              color: '#fff',
              fontSize: 13,
              userSelect: 'none',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <span style={{ visibility: bootstrapReady && currentGameKind ? 'visible' : 'hidden' }}>
            {currentGameKind === 'daily'
              ? `Daily Challenge: ${currentDailyDate} (${gameState.seed})`
              : currentGameKind === 'random'
                ? `Random (${gameState.seed})`
                : currentGameKind === 'event'
                  ? `Special Event (${gameState.seed})`
                : `Winning Deal (${gameState.seed})`}
            </span>
          </span>
          <span
            style={{
              color: '#fff',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              userSelect: 'none',
            }}
          >
            <CoinsIcon size={14} /> <span style={{ visibility: profileReady ? 'visible' : 'hidden' }}>{coins}</span>
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 'clamp(24px, 6vw, 80px)',
            alignItems: 'flex-start',
            pointerEvents: 'none',
          }}
        >
          <div style={hudColStyle}>
            <span style={hudLabelStyle}>Score</span>
            <span style={hudValueStyle}>{score}</span>
          </div>
          <ElapsedClock />
          <div style={hudColStyle}>
            <span style={hudLabelStyle}>Moves</span>
            <span style={hudValueStyle}>{moves}</span>
          </div>
        </div>
      </div>

      <button
        style={{ ...fab, left: fabLeft(0) }}
        aria-label="Main Menu"
        onClick={() => setSettingsDialogOpen(true)}
      >
        <Menu size={20} />
      </button>

      <button
        className={newGameNeedsAttention ? 'new-game-attention' : undefined}
        style={{ ...fab, left: fabLeft(1) }}
        aria-label={newGameNeedsAttention ? 'New Game — start a new deal' : 'New Game'}
        title={newGameNeedsAttention ? 'Start a new game' : 'New Game'}
        onClick={() => setNewGameDialogOpen(true)}
      >
        <Plus size={20} />
      </button>

       <button
        style={{ ...fab, right: 16 + FAB_WIDTH + FAB_GAP, opacity: locked ? 0.4 : 1 }}
        aria-label="Hint: show available moves (H)"
        data-hint-button
        disabled={locked}
        onClick={showHints}
      >
        <Lightbulb size={20} />
      </button>

       <button
        style={{ ...fab, right: 16, opacity: locked || !canUndo ? 0.4 : 1, touchAction: 'manipulation' }}
        aria-label="Undo"
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
      />

       <ConfirmModal
        open={noMovesDialogOpen}
        dismissable={false}
        title="No moves remaining"
        message="There don't seem to be any more valid moves. You can keep going to recycle the stock, undo your last move, replay this exact deal, or start a new game."
        confirmText={currentGameKind === 'daily' ? 'Return to Daily Challenge' : 'New Game'}
        cancelText="Undo Last Move"
        tertiaryText="Replay this Game"
        onTertiary={onNoMovesReplay}
        quaternaryText="Keep Going"
        onQuaternary={onNoMovesKeepGoing}
        onConfirm={currentGameKind === 'daily' ? onNoMovesReturnDaily : onNoMovesConfirm}
        onCancel={onNoMovesCancel}
        onCloseIcon={onNoMovesKeepGoing}
      />

       <ConfirmModal
        open={gameOverDialogOpen}
        title="Game Over"
        message={
          overReason === 'moves'
            ? "You reached the 500-move limit. Close this message, then start a new game to keep playing."
            : "You reached the 30:00 time limit. Close this message, then start a new game to keep playing."
        }
        confirmText="OK"
        hideCancel
        dismissable={false}
        onConfirm={closeGameOver}
        onCancel={closeGameOver}
        onCloseIcon={closeGameOver}
      />

      <ConfirmModal
        open={confirmNewGameDialogOpen}
        title="Start a new game?"
        zIndex={Z.GRANDCHILD}
        z={Z.GRANDCHILD}
        message="The current game is in progress. Starting a new game will discard your current progress. This game will count as a loss and be recorded in your statistics."
        confirmText="New Game"
        cancelText="Cancel"
        onConfirm={onConfirmNewGame}
        onCancel={() => {
          useUiStore.getState().setPendingStartDeal(null);
          setConfirmNewGameDialogOpen(false);
        }}
      />
    </>
  );
}
