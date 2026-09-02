// components/StatisticsModal.jsx
// Cumulative stats dialog: total games played, total games won (with % of
// played), highest score of a won game, lowest winning time, and fewest winning
// moves. Mirrors the visual chrome (theme CSS variables, panel/backdrop styling,
// focus-on-open, Escape/backdrop-to-close) of SettingsModal / ConfirmModal.
//
// A Reset button at the bottom clears every cumulative stat; it is gated behind
// a confirmation dialog so an accidental tap can't wipe history.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Coins as CoinsIcon } from 'lucide-react';
import { useStatisticsStore } from '../hooks/useStatisticsStore.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { useGameStore } from '../hooks/useGameStore.js';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { useModalBackdrop } from './modalBackdrop.js';
import ConfirmModal from './ConfirmModal.jsx';
import { formatTime } from '../utils/formatTime.js';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function StatisticsModal({ open, onClose }) {
  const { t } = useTranslation();
  const stats = useStatisticsStore((s) => s.stats);
  const reset = useStatisticsStore((s) => s.reset);
  const isGameInProgress = () => {
    const live = useStatsStore.getState();
    const won = useGameStore.getState().isWon();
    return live.startTime !== null && !live.isOver && !won;
  };
  const coinsEarnedTotal = useAuthStore((s) => s.coinsEarnedTotal);
  const coinsSpentTotal = useAuthStore((s) => s.coinsSpentTotal);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const dialogRef = useRef(null);
  const scrollRef = useRef(null);
  const [scrollMetrics, setScrollMetrics] = useState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
  const backdrop = useModalBackdrop(onClose);

  const isEmpty =
    stats.totalGamesPlayed === 0 &&
    stats.totalGamesWon === 0 &&
    stats.bestStreak === 0 &&
    stats.currentStreak === 0 &&
    stats.lowestTimeMs == null &&
    stats.lowestMoves == null &&
    stats.totalTimeMsWon === 0 &&
    stats.totalMovesWon === 0;

  useModalEscape({ open, onClose, id: 'stats', z: Z.BASE });

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setScrollMetrics({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
      return undefined;
    }
    const element = scrollRef.current;
    if (!element) return undefined;
    const update = () => setScrollMetrics({ scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight });
    element.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [open, isEmpty]);

  if (!open) return null;

  const wonPct =
    stats.totalGamesPlayed > 0
      ? Math.round((stats.totalGamesWon / stats.totalGamesPlayed) * 100)
      : 0;

  const avgTimeMs =
    stats.totalGamesWon > 0 ? stats.totalTimeMsWon / stats.totalGamesWon : null;
  const avgMoves =
    stats.totalGamesWon > 0 ? stats.totalMovesWon / stats.totalGamesWon : null;

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
    position: 'relative',
    background: 'var(--ui-modal-panel-bg)',
    color: 'var(--ui-modal-panel-fg)',
    border: 'var(--ui-modal-panel-border)',
    borderRadius: 'var(--ui-modal-panel-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(90vw, 420px)',
    maxWidth: '100%',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };
  const showScrollUp = scrollMetrics.scrollTop > 0;
  const showScrollDown = scrollMetrics.scrollTop + scrollMetrics.clientHeight < scrollMetrics.scrollHeight - 1;
  const scrollButton = { position: 'absolute', left: '50%', transform: 'translateX(-50%)', width: 34, height: 28, display: 'grid', placeItems: 'center', padding: 0, border: '1px solid var(--ui-modal-panel-border)', borderRadius: 999, background: 'color-mix(in srgb, var(--ui-modal-panel-bg) 82%, transparent)', color: 'var(--ui-modal-panel-fg)', boxShadow: '0 2px 8px rgba(0,0,0,0.22)', backdropFilter: 'blur(4px)', cursor: 'pointer', zIndex: 1 };

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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('statistics.title')}
        tabIndex={-1}
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
          <h2 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>{t('statistics.title')}</h2>
          <ModalCloseButton onClick={onClose} />

          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <div ref={scrollRef} className="modal-body-scroll" style={{ height: '100%' }}>
            <div style={row}>
              <span style={labelStyle}>{t('statistics.totalPlayed')}</span>
              <span style={valueStyle}>{stats.totalGamesPlayed}</span>
            </div>
            <div style={row}>
              <span style={labelStyle}>{t('statistics.totalWon', { pct: wonPct })}</span>
              <span style={valueStyle}>{stats.totalGamesWon}</span>
            </div>
            <div style={row}>
              <span style={labelStyle}>{t('statistics.highestScore')}</span>
              <span style={valueStyle}>{stats.highestScore}</span>
            </div>
            <div style={row}>
              <span style={labelStyle}>{t('statistics.lowestTime')}</span>
              <span style={valueStyle}>{stats.lowestTimeMs == null ? t('statistics.na') : formatTime(stats.lowestTimeMs)}</span>
            </div>
            <div style={row}>
              <span style={labelStyle}>{t('statistics.lowestMoves')}</span>
              <span style={valueStyle}>{stats.lowestMoves == null ? t('statistics.na') : stats.lowestMoves}</span>
            </div>
            <div style={row}>
              <span style={labelStyle}>{t('statistics.avgTime')}</span>
              <span style={valueStyle}>{avgTimeMs == null ? t('statistics.na') : formatTime(avgTimeMs)}</span>
            </div>
            <div style={{ ...row, borderBottom: 'none' }}>
              <span style={labelStyle}>{t('statistics.avgMoves')}</span>
              <span style={valueStyle}>{avgMoves == null ? t('statistics.na') : Math.round(avgMoves)}</span>
            </div>

            <div style={{ ...row, borderTop: '1px solid var(--ui-control-border)' }}>
              <span style={labelStyle}>{t('statistics.currentStreak')}</span>
              <span
                style={{
                  ...valueStyle,
                  color:
                    stats.currentStreak > 0 && stats.currentStreak >= stats.bestStreak
                      ? '#1a7f37'
                      : 'var(--ui-modal-panel-fg)',
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
                    {t('common.new')}
                  </span>
                )}
              </span>
            </div>
            <div style={{ ...row, borderBottom: 'none' }}>
              <span style={labelStyle}>{t('statistics.bestStreak')}</span>
              <span style={valueStyle}>{stats.bestStreak}</span>
            </div>

            <div style={{ ...row, borderTop: '1px solid var(--ui-control-border)' }}>
              <span style={labelStyle}>{t('statistics.coinsEarned')}</span>
              <span style={{ ...valueStyle, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <CoinsIcon size={13} aria-hidden="true" />
                {coinsEarnedTotal}
              </span>
            </div>
            <div style={{ ...row, borderBottom: 'none' }}>
              <span style={labelStyle}>{t('statistics.coinsSpent')}</span>
              <span style={{ ...valueStyle, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <CoinsIcon size={13} aria-hidden="true" />
                {coinsSpentTotal}
              </span>
            </div>
          </div>
          {showScrollUp && <button type="button" aria-label={t('statistics.scrollTop')} onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} style={{ ...scrollButton, top: 8 }}><ChevronUp size={18} strokeWidth={2.5} aria-hidden="true" /></button>}
          {showScrollDown && <button type="button" aria-label={t('statistics.scrollBottom')} onClick={() => { const element = scrollRef.current; element?.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }); }} style={{ ...scrollButton, bottom: 8 }}><ChevronDown size={18} strokeWidth={2.5} aria-hidden="true" /></button>}
          </div>

          {!isEmpty && (
            <button
              type="button"
              style={{
                marginTop: 12,
                padding: '10px 14px',
                borderRadius: 6,
                border: '1px solid var(--ui-modal-btn-border)',
                background: 'var(--ui-modal-btn-bg-danger, #b23b3b)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
              }}
              onClick={() => setConfirmResetOpen(true)}
            >
              {t('statistics.reset')}
            </button>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmResetOpen}
        title={t('statistics.confirm.title')}
        message={
          t('statistics.confirm.message') +
          (isGameInProgress() ? t('statistics.confirm.inProgress') : "")
        }
        confirmText={t('confirm.reset')}
        cancelText={t('common.cancel')}
        onConfirm={() => {
          setConfirmResetOpen(false);
          // If a game is currently in progress (timer running and not won), the
          // reset zeroes stats (Total Games Played -> 0) and the in-progress game
          // is discarded and re-dealt — equivalent to clicking "Replay this Game".
          // A won (or hard-limit) game is already over, so it is just reset.
          const inProgress = isGameInProgress();
          reset();
          if (inProgress) useGameStore.getState().replayGame();
        }}
        onCancel={() => setConfirmResetOpen(false)}
      />
    </>
  );
}
