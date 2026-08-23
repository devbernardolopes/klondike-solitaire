// components/WinModal.jsx
// Modal shown when the game is won. Displays the finished game's Score, Time and
// Moves. Any of those that beat the stored best are rendered in a distinct
// (green) color with a small reddish "new" badge; the others use the normal
// theme text color. Two buttons let the player start a new game in the current
// mode or replay the exact same deal. Dismissed by clicking outside the panel,
// pressing Escape, or either button.

import { useEffect, useRef } from 'react';
import { useUiStore } from '../hooks/useUiStore.js';
import { useGameStore } from '../hooks/useGameStore.js';
import { useModalBackdrop } from './modalBackdrop.js';
import { formatTime } from '../utils/formatTime.js';

// Color used for a value that is a new record (distinct from normal text).
const NEW_VALUE_COLOR = '#1a7f37';
// Color of the small "new" badge next to a new record.
const NEW_BADGE_COLOR = '#e53935';

export default function WinModal() {
  const winDialogOpen = useUiStore((s) => s.winDialogOpen);
  const summary = useUiStore((s) => s.winSummary);
  const closeWinDialog = useUiStore((s) => s.closeWinDialog);
  const dealNewGame = useGameStore((s) => s.dealNewGame);
  const replayGame = useGameStore((s) => s.replayGame);

  const backdrop = useModalBackdrop(closeWinDialog);
  const panelRef = useRef(null);

  // Focus the panel on open, and close on Escape (consistent with ConfirmModal).
  useEffect(() => {
    if (!winDialogOpen) return;
    panelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') closeWinDialog();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [winDialogOpen, closeWinDialog]);

  if (!winDialogOpen || !summary) return null;

  const { score, timeMs, moves, newScore, newTime, newMoves } = summary;

  const onNewGame = () => {
    closeWinDialog();
    dealNewGame(useUiStore.getState().lastNewGameMode);
  };
  const onReplay = () => {
    closeWinDialog();
    replayGame();
  };

  const btn = {
    padding: '9px 14px',
    borderRadius: 6,
    border: '1px solid var(--ui-modal-btn-border)',
    background: 'var(--ui-modal-btn-bg)',
    color: 'var(--ui-modal-fg)',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
  };

  const panel = {
    background: 'var(--card-face-bg)',
    color: 'var(--card-text-black)',
    border: 'var(--card-border)',
    borderRadius: 'var(--card-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '22px 24px',
    width: 'min(90vw, 380px)',
    maxWidth: '100%',
    outline: 'none',
  };

  // A single stat row: label, value, and (when a new record) a green value +
  // red "new" badge.
  const StatRow = ({ label, value, isNew }) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 0',
        borderBottom: '1px solid var(--card-border)',
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: isNew ? NEW_VALUE_COLOR : 'var(--card-text-black)',
          }}
        >
          {value}
        </span>
        {isNew && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: NEW_BADGE_COLOR,
              textTransform: 'lowercase',
            }}
          >
            new
          </span>
        )}
      </span>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="You Won"
      {...backdrop}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
        padding: 16,
      }}
    >
      <div ref={panelRef} tabIndex={-1} style={panel}>
        <h2
          style={{
            margin: '0 0 14px',
            fontSize: 22,
            fontWeight: 800,
            textAlign: 'center',
          }}
        >
          You Won
        </h2>

        <div style={{ marginBottom: 18 }}>
          <StatRow label="Score" value={String(score)} isNew={newScore} />
          <StatRow label="Time" value={formatTime(timeMs)} isNew={newTime} />
          <StatRow label="Moves" value={String(moves)} isNew={newMoves} />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'stretch' }}>
          <button type="button" style={{ ...btn, flex: 1 }} onClick={onNewGame}>
            New Game
          </button>
          <button
            type="button"
            style={{ ...btn, flex: 1, background: 'var(--ui-modal-btn-bg-strong)' }}
            onClick={onReplay}
          >
            Replay this Game
          </button>
        </div>
      </div>
    </div>
  );
}
