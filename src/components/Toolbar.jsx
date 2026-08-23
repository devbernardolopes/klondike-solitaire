// components/Toolbar.jsx
// New game, undo, theme/deck switchers. Stubs OK for switchers this pass.

import pkg from '../../package.json';
import { useEffect, useCallback, useState, useRef } from 'react';
import { Plus, Undo2, Settings, BarChart3, Lightbulb } from 'lucide-react';
import { useGameStore } from '../hooks/useGameStore.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { useSound } from '../hooks/useSound.js';
import { isWon } from '../core/winDetection.js';
import ConfirmModal from './ConfirmModal.jsx';
import NewGameModal from './NewGameModal.jsx';
import SettingsModal from './SettingsModal.jsx';
import StatisticsModal from './StatisticsModal.jsx';
import SeedInputModal from './SeedInputModal.jsx';

/**
 * Format an elapsed-time span (ms) as MM:SS.
 * @param {number} totalMs
 * @returns {string}
 */
function formatTime(totalMs) {
  const totalSec = Math.max(0, Math.floor(totalMs / 1000));
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

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
 */
export default function Toolbar({ theme, onThemeChange, deck, onDeckChange, handedness, onHandednessChange, highlightCard, onHighlightCardChange }) {
  const dealNewGame = useGameStore((s) => s.dealNewGame);
  const dealWithSeed = useGameStore((s) => s.dealWithSeed);
  const replayGame = useGameStore((s) => s.replayGame);
  const undo = useGameStore((s) => s.undo);
  const showHints = useGameStore((s) => s.showHints);
  const canUndo = useGameStore((s) => s.canUndo());
  const autoCompleting = useGameStore((s) => s.autoCompleting);
  const won = useGameStore((s) => isWon(s.state));
  const isOver = useStatsStore((s) => s.isOver);
  const overReason = useStatsStore((s) => s.overReason);
  const { play } = useSound();

  const newGameDialogOpen = useUiStore((s) => s.newGameDialogOpen);
  const setNewGameDialogOpen = useUiStore((s) => s.setNewGameDialogOpen);
  const lastNewGameMode = useUiStore((s) => s.lastNewGameMode);
  const noMovesDialogOpen = useUiStore((s) => s.noMovesDialogOpen);
  const setNoMovesDialogOpen = useUiStore((s) => s.setNoMovesDialogOpen);
  const settingsDialogOpen = useUiStore((s) => s.settingsDialogOpen);
  const setSettingsDialogOpen = useUiStore((s) => s.setSettingsDialogOpen);
  const setHelpDialogOpen = useUiStore((s) => s.setHelpDialogOpen);
  const statsDialogOpen = useUiStore((s) => s.statsDialogOpen);
  const setStatsDialogOpen = useUiStore((s) => s.setStatsDialogOpen);
  const seedInputDialogOpen = useUiStore((s) => s.seedInputDialogOpen);
  const setSeedInputDialogOpen = useUiStore((s) => s.setSeedInputDialogOpen);
  const setAnnounce = useUiStore((s) => s.setAnnounce);
  const gameOverDialogOpen = useUiStore((s) => s.gameOverDialogOpen);
  const setGameOverDialogOpen = useUiStore((s) => s.setGameOverDialogOpen);

  // Game session stats (moves / score) + live elapsed time for the HUD.
  const gameState = useGameStore((s) => s.state);
  const moves = useStatsStore((s) => s.moves);
  const score = useStatsStore((s) => s.score);

  // The session locks (won, a hard limit hit, or a winning auto-complete in
  // progress) — disable undo/hint and surface the Game Over dialog when a limit
  // (not a win) ended the game.
  const locked = won || isOver || autoCompleting;
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
  const closeStats = useCallback(() => setStatsDialogOpen(false), [setStatsDialogOpen]);
  const closeNewGame = useCallback(() => setNewGameDialogOpen(false), [setNewGameDialogOpen]);
  const onReplay = useCallback(() => {
    setNewGameDialogOpen(false);
    replayGame();
    play('deal');
  }, [setNewGameDialogOpen, replayGame, play]);
  const onWinningDeal = useCallback(() => {
    setNewGameDialogOpen(false);
    dealNewGame('winning');
    play('deal');
  }, [setNewGameDialogOpen, dealNewGame, play]);
  const onRandomShuffle = useCallback(() => {
    setNewGameDialogOpen(false);
    dealNewGame('random');
    play('deal');
  }, [setNewGameDialogOpen, dealNewGame, play]);
  const onSeedConfirm = useCallback((seed) => {
    setSeedInputDialogOpen(false);
    dealWithSeed(seed);
    play('deal');
    setAnnounce(`New game: seed ${seed}`);
  }, [setSeedInputDialogOpen, dealWithSeed, play, setAnnounce]);
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
  const closeGameOver = useCallback(() => setGameOverDialogOpen(false), [setGameOverDialogOpen]);
  const onGameOverConfirm = useCallback(() => {
    setGameOverDialogOpen(false);
    dealNewGame(lastNewGameMode);
  }, [setGameOverDialogOpen, dealNewGame, lastNewGameMode]);

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

  // Bottom-left cluster, left-to-right: [Settings] [Statistics] [New Game].
  // Each is fixed-bottom and ~40px wide with a 12px gap; the third sits 2 slots
  // in from the edge.
  const FAB_WIDTH = 40;
  const FAB_GAP = 12;
  const fabLeft = (slot) => 16 + slot * (FAB_WIDTH + FAB_GAP);

  // Larger, centered font used by the Score / Time / Moves HUD row.
const hudLabelStyle = {
  color: '#fff',
  fontSize: 22,
  fontWeight: 700,
  userSelect: 'none',
};

/**
 * Live elapsed-time HUD cell. Isolated into its own component so the 250ms
 * tick that refreshes the clock only re-renders this node, not the whole
 * Toolbar (and, critically, not the dialog subtrees rendered alongside it).
 * @returns {JSX.Element}
 */
function ElapsedClock() {
  const elapsed = useElapsed();
  return <span style={hudLabelStyle}>Time: {elapsed}</span>;
}

  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: '8px clamp(8px, 2vw, 20px)',
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
            {lastNewGameMode === 'winning' ? `Seed: ${gameState.seed}` : 'Random'}
          </span>
         <span
           style={{
             color: '#fff',
             fontSize: 13,
             marginLeft: 'auto',
             userSelect: 'none',
           }}
         >
           v{pkg.version}
         </span>
       </div>

       <div
         style={{
           display: 'flex',
           justifyContent: 'center',
           gap: 'clamp(24px, 6vw, 80px)',
           alignItems: 'center',
           padding: '4px clamp(8px, 2vw, 20px) 10px',
         }}
       >
          <span style={hudLabelStyle}>Score: {score}</span>
          <ElapsedClock />
          <span style={hudLabelStyle}>Moves: {moves}</span>
       </div>

      <button
        style={{ ...fab, left: fabLeft(0) }}
        aria-label="Settings"
        onClick={() => setSettingsDialogOpen(true)}
      >
        <Settings size={20} />
      </button>

      <button
        style={{ ...fab, left: fabLeft(1) }}
        aria-label="Statistics"
        onClick={() => setStatsDialogOpen(true)}
      >
        <BarChart3 size={20} />
      </button>

      <button
        style={{ ...fab, left: fabLeft(2) }}
        aria-label="New Game"
        onClick={() => setNewGameDialogOpen(true)}
      >
        <Plus size={20} />
      </button>

       <button
        style={{ ...fab, right: 16 + FAB_WIDTH + FAB_GAP, opacity: locked ? 0.4 : 1 }}
        aria-label="Hint: show available moves (H)"
        disabled={locked}
        onClick={showHints}
      >
        <Lightbulb size={20} />
      </button>

       <button
        style={{ ...fab, right: 16, opacity: locked || !canUndo ? 0.4 : 1 }}
        aria-label="Undo"
        disabled={locked || !canUndo}
        onClick={undo}
      >
        <Undo2 size={20} />
      </button>

      <NewGameModal
        open={newGameDialogOpen}
        onReplay={onReplay}
        onWinningDeal={onWinningDeal}
        onRandomShuffle={onRandomShuffle}
        onDismiss={closeNewGame}
      />

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
      />

      <StatisticsModal
        open={statsDialogOpen}
        onClose={closeStats}
      />

       <ConfirmModal
        open={noMovesDialogOpen}
        title="No moves remaining"
        message="There don't seem to be any more valid moves. You can undo your last move, restart this exact deal, or start a new game."
        confirmText="New Game"
        cancelText="Undo Last Move"
        tertiaryText="Replay this Game"
        onTertiary={onNoMovesReplay}
        onConfirm={onNoMovesConfirm}
        onCancel={onNoMovesCancel}
      />

      <ConfirmModal
        open={gameOverDialogOpen}
        title="Game Over"
        message={
          overReason === 'moves'
            ? "You reached the 999-move limit. Start a new game to keep playing."
            : "You reached the 60:00 time limit. Start a new game to keep playing."
        }
        confirmText="New Game"
        hideCancel
        onConfirm={onGameOverConfirm}
        onCancel={closeGameOver}
      />
    </>
  );
}
