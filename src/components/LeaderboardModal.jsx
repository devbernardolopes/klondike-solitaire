// components/LeaderboardModal.jsx
// Read-only display of the public Supabase leaderboard view (linked accounts
// only). Reached from Settings. Renders a ranked top-20 list per category tab
// (coins / games won / best streak / highest score / fastest win / fewest
// moves), highlighting the signed-in user's own row when present. This is
// display-only: an offline / missing-env client or any fetch error simply shows
// an empty list — it gates nothing. Mirrors the visual chrome (panel/backdrop,
// focus-on-open, Escape/backdrop-to-close) of SettingsModal.jsx.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { formatTime } from '../utils/formatTime.js';

/**
 * @typedef {Object} LeaderboardTab
 * @property {string} key
 * @property {string} label
 * @property {string} column
 * @property {boolean} ascending
 * @property {(v: any) => string} format
 */

const TAB_KEY_TO_I18N = {
  coins: 'leaderboard.tabs.coins',
  games_won: 'leaderboard.tabs.gamesWon',
  best_streak: 'leaderboard.tabs.bestStreak',
  highest_score: 'leaderboard.tabs.highestScore',
  lowest_time_ms: 'leaderboard.tabs.fastestWin',
  lowest_moves: 'leaderboard.tabs.fewestMoves',
};

/** @type {LeaderboardTab[]} */
const TABS = [
  { key: 'coins', column: 'coins_earned_total', ascending: false, format: (v) => String(v ?? 0) },
  { key: 'games_won', column: 'games_won', ascending: false, format: (v) => String(v ?? 0) },
  { key: 'best_streak', column: 'best_streak', ascending: false, format: (v) => String(v ?? 0) },
  { key: 'highest_score', column: 'highest_score', ascending: false, format: (v) => String(v ?? 0) },
  { key: 'lowest_time_ms', column: 'lowest_time_ms', ascending: true, format: (v) => (v == null ? '—' : formatTime(v)) },
  { key: 'lowest_moves', column: 'lowest_moves', ascending: true, format: (v) => (v == null ? '—' : String(v)) },
];

const LEADERBOARD_COLUMNS =
  'id, display_name, coins, coins_earned_total, games_played, games_won, current_streak, ' +
  'best_streak, highest_score, lowest_time_ms, lowest_moves, lowest_undos';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function LeaderboardModal({ open, onClose }) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);
  const userId = useAuthStore((s) => s.userId);
  const [activeTab, setActiveTab] = useState('coins');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useModalEscape({ open, onClose, id: 'leaderboard', z: Z.CHILD });

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
  }, [open]);

  // Fetch the top 20 for the active tab whenever the modal opens or the tab
  // changes. A null client (offline / missing env) or fetch error leaves the
  // list empty — display-only, so no error state.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setRows([]);

    const run = async () => {
      if (!supabase) {
        if (!cancelled) setLoading(false);
        return;
      }
      const cfg = TABS.find((t) => t.key === activeTab);
      let query = supabase
        .from('leaderboard')
        .select(LEADERBOARD_COLUMNS)
        .order(cfg.column, { ascending: cfg.ascending })
        .limit(100);
      if (cfg.ascending) {
        query = query.not(cfg.column, 'is', null);
      } else {
        query = query.gt(cfg.column, 0);
      }
      const { data, error } = await query;
      if (cancelled) return;
      setRows(error ? [] : (data ?? []));
      setLoading(false);
    };
    run();

    return () => {
      cancelled = true;
    };
  }, [open, activeTab]);

  if (!open) return null;

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

  const tabBtn = (active) => ({
    ...btn,
    padding: '6px 10px',
    fontSize: 13,
    background: active ? 'var(--ui-modal-btn-bg-strong)' : 'var(--ui-modal-btn-bg)',
    opacity: active ? 1 : 0.85,
  });

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
    height: '85vh',
    display: 'flex',
    flexDirection: 'column',
  };

  const cfg = TABS.find((t) => t.key === activeTab);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('leaderboard.title')}
      tabIndex={-1}
      ref={dialogRef}
      {...backdrop}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3100,
        padding: 16,
      }}
    >
      <div style={panel}>
        <h2 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>{t('leaderboard.title')}</h2>
        <ModalCloseButton onClick={onClose} />

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 14,
          }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              style={tabBtn(tab.key === activeTab)}
              onClick={() => setActiveTab(tab.key)}
            >
              {t(TAB_KEY_TO_I18N[tab.key])}
            </button>
          ))}
        </div>

        <div className="modal-body-scroll" style={{ flex: 1, minHeight: 0 }}>
          {loading ? (
            <div style={{ opacity: 0.7, fontSize: 14 }}>{t('leaderboard.loading')}</div>
          ) : rows.length === 0 ? (
            <div style={{ opacity: 0.7, fontSize: 14 }}>{t('leaderboard.empty')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rows.map((row, i) => {
                const isMe = userId != null && row.id === userId;
                return (
                  <div
                    key={row.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: isMe ? '2px solid var(--ui-leaderboard-me-border)' : '1px solid var(--ui-modal-panel-border)',
                      background: isMe ? 'var(--ui-modal-btn-bg-strong)' : 'transparent',
                      fontWeight: isMe ? 700 : 400,
                    }}
                  >
                    <span style={{ minWidth: 28, opacity: 0.7 }}>{i + 1}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.display_name ?? '—'}
                    </span>
                    <span style={{ fontWeight: 700 }}>{cfg.format(row[cfg.column])}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
