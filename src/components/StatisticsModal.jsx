// components/StatisticsModal.jsx
// Cumulative stats dialog: total games played, total games won (with % of
// played), highest score of a won game, lowest winning time, and fewest winning
// moves. Mirrors the visual chrome (theme CSS variables, panel/backdrop styling,
// focus-on-open, Escape/backdrop-to-close) of SettingsModal / ConfirmModal.
//
// A Reset button at the bottom clears every cumulative stat; it is gated behind
// a confirmation dialog so an accidental tap can't wipe history.

import { useEffect, useRef, useState } from 'react';
import { useStatisticsStore } from '../hooks/useStatisticsStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { useModalBackdrop } from './modalBackdrop.js';
import ConfirmModal from './ConfirmModal.jsx';

/**
 * Format an elapsed-time span (ms) as MM:SS.
 * @param {number|null} totalMs
 * @returns {string}
 */
function formatTime(totalMs) {
  if (totalMs == null) return '—';
  const totalSec = Math.max(0, Math.floor(totalMs / 1000));
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function StatisticsModal({ open, onClose }) {
  const stats = useStatisticsStore((s) => s.stats);
  const reset = useStatisticsStore((s) => s.reset);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const closeRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);

  // Read the close handler via a ref so this effect runs once per open (depends
  // only on `open`), not whenever the handler identity changes.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const wonPct =
    stats.totalGamesPlayed > 0
      ? Math.round((stats.totalGamesWon / stats.totalGamesPlayed) * 100)
      : 0;

  const btn = {
    padding: '8px 14px',
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
    padding: '20px 22px',
    width: 'min(90vw, 360px)',
    maxWidth: '100%',
  };

  const row = {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    padding: '8px 0',
    borderBottom: '1px solid var(--ui-control-border)',
  };
  const labelStyle = { fontSize: 14, fontWeight: 600 };
  const valueStyle = { fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Statistics"
      {...backdrop}
      style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 3000,
          padding: 16,
        }}
      >
        <div style={panel}>
          <h2 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700 }}>Statistics</h2>

          <div style={row}>
            <span style={labelStyle}>Total games played</span>
            <span style={valueStyle}>{stats.totalGamesPlayed}</span>
          </div>
          <div style={row}>
            <span style={labelStyle}>Total games won</span>
            <span style={valueStyle}>
              {stats.totalGamesWon}{' '}
              <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.8 }}>
                ({wonPct}%)
              </span>
            </span>
          </div>
          <div style={row}>
            <span style={labelStyle}>Highest score (won)</span>
            <span style={valueStyle}>{stats.highestScore}</span>
          </div>
          <div style={row}>
            <span style={labelStyle}>Lowest time (won)</span>
            <span style={valueStyle}>{formatTime(stats.lowestTimeMs)}</span>
          </div>
          <div style={{ ...row, borderBottom: 'none' }}>
            <span style={labelStyle}>Lowest moves (won)</span>
            <span style={valueStyle}>{stats.lowestMoves == null ? '—' : stats.lowestMoves}</span>
          </div>

          <div style={{ ...row, borderTop: '1px solid var(--ui-control-border)' }}>
            <span style={labelStyle}>Current Winning Streak</span>
            <span
              style={{
                ...valueStyle,
                color:
                  stats.currentStreak > 0 && stats.currentStreak >= stats.bestStreak
                    ? '#1a7f37'
                    : 'var(--card-text-black)',
              }}
            >
              {stats.currentStreak}
              {stats.currentStreak > 0 && stats.currentStreak >= stats.bestStreak && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#e53935',
                  }}
                >
                  new
                </span>
              )}
            </span>
          </div>
          <div style={{ ...row, borderBottom: 'none' }}>
            <span style={labelStyle}>Best Winning Streak</span>
            <span style={valueStyle}>{stats.bestStreak}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18, gap: 10 }}>
            <button
              type="button"
              style={{ ...btn, background: 'var(--ui-modal-btn-bg-danger, #b23b3b)', color: '#fff' }}
              onClick={() => setConfirmResetOpen(true)}
            >
              Reset
            </button>
            <button
              type="button"
              ref={closeRef}
              style={{ ...btn, background: 'var(--ui-modal-btn-bg-strong)' }}
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmResetOpen}
        title="Reset statistics?"
        message="This will permanently remove all saved score, time, moves, undos, winning streaks, and games-played data. This cannot be undone."
        confirmText="Reset"
        cancelText="Cancel"
        onConfirm={() => {
          setConfirmResetOpen(false);
          // If a game is currently in progress (timer running), count it so
          // Total Games Played resets to 1 instead of 0.
          const live = useStatsStore.getState();
          const inProgress = live.startTime !== null && !live.isOver;
          reset(inProgress);
        }}
        onCancel={() => setConfirmResetOpen(false)}
      />
    </>
  );
}
