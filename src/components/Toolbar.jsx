// components/Toolbar.jsx
// New game, undo, theme/deck switchers. Stubs OK for switchers this pass.

import pkg from '../../package.json';
import { useEffect, useState } from 'react';
import { Plus, Undo2, Settings, BarChart3 } from 'lucide-react';
import { useGameStore } from '../hooks/useGameStore.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { useSound } from '../hooks/useSound.js';
import { isWon } from '../core/winDetection.js';
import ConfirmModal from './ConfirmModal.jsx';
import NewGameModal from './NewGameModal.jsx';
import SettingsModal from './SettingsModal.jsx';
import StatisticsModal from './StatisticsModal.jsx';

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
 * accumulating interval ticks) so it stays accurate even when the tab loses
 * focus. A short interval only exists to refresh the displayed value.
 * @returns {string} "MM:SS"
 */
function useElapsed() {
  const startTime = useStatsStore((s) => s.startTime);
  const endTime = useStatsStore((s) => s.endTime);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startTime === null) return undefined;
    const id = setInterval(() => {
      setNow(Date.now());
      useStatsStore.getState().checkTimeLimit();
    }, 250);
    return () => clearInterval(id);
  }, [startTime]);
  const elapsed = startTime === null ? 0 : (endTime ?? now) - startTime;
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
 */
export default function Toolbar({ theme, onThemeChange, deck, onDeckChange, handedness, onHandednessChange }) {
  const dealNewGame = useGameStore((s) => s.dealNewGame);
  const undo = useGameStore((s) => s.undo);
  const canUndo = useGameStore((s) => s.state.moveHistory.length > 0);
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
  const statsDialogOpen = useUiStore((s) => s.statsDialogOpen);
  const setStatsDialogOpen = useUiStore((s) => s.setStatsDialogOpen);
  const gameOverDialogOpen = useUiStore((s) => s.gameOverDialogOpen);
  const setGameOverDialogOpen = useUiStore((s) => s.setGameOverDialogOpen);

  // Game session stats (moves / score) + live elapsed time for the HUD.
  const gameState = useGameStore((s) => s.state);
  const moves = useStatsStore((s) => s.moves);
  const score = useStatsStore((s) => s.score);
  const elapsed = useElapsed();

  // The session locks (won or a hard limit hit) — disable undo and surface the
  // Game Over dialog when a limit (not a win) ended the game.
  const locked = won || isOver;
  useEffect(() => {
    if (isOver) setGameOverDialogOpen(true);
  }, [isOver, setGameOverDialogOpen]);

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
           style={{
             color: '#fff',
             fontSize: 13,
             userSelect: 'none',
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
         <span style={hudLabelStyle}>Time: {elapsed}</span>
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
        style={{ ...fab, right: 16, opacity: locked || !canUndo ? 0.4 : 1 }}
        aria-label="Undo"
        disabled={locked || !canUndo}
        onClick={undo}
      >
        <Undo2 size={20} />
      </button>

      <NewGameModal
        open={newGameDialogOpen}
        onWinningDeal={() => {
          setNewGameDialogOpen(false);
          dealNewGame('winning');
          play('deal');
        }}
        onRandomShuffle={() => {
          setNewGameDialogOpen(false);
          dealNewGame('random');
          play('deal');
        }}
        onDismiss={() => setNewGameDialogOpen(false)}
      />

      <SettingsModal
        open={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
        theme={theme}
        onThemeChange={onThemeChange}
        deck={deck}
        onDeckChange={onDeckChange}
        handedness={handedness}
        onHandednessChange={onHandednessChange}
      />

      <StatisticsModal
        open={statsDialogOpen}
        onClose={() => setStatsDialogOpen(false)}
      />

       <ConfirmModal
        open={noMovesDialogOpen}
        title="No moves remaining"
        message="There don't seem to be any more valid moves. You can undo your last move or start a new game."
        confirmText="New Game"
        cancelText="Undo Last Move"
        onConfirm={() => {
          setNoMovesDialogOpen(false);
          dealNewGame(lastNewGameMode);
        }}
        onCancel={() => {
          setNoMovesDialogOpen(false);
          undo();
        }}
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
        onConfirm={() => {
          setGameOverDialogOpen(false);
          dealNewGame(lastNewGameMode);
        }}
        onCancel={() => setGameOverDialogOpen(false)}
      />
    </>
  );
}
