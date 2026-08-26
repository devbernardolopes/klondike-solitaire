// components/AchievementsModal.jsx
// Read-only display of the currently signed-in user's unlocked achievements,
// pulled from Supabase's achievements_unlocked table. This is a nice-to-have
// display only — it gates nothing, and a failed/offline fetch simply leaves
// every achievement looking locked. Achievement ids/names live in
// data/achievements.js (the DB stores only the earned ids). Mirrors the visual
// chrome (panel/backdrop, focus-on-open, Escape/backdrop-to-close) of
// SettingsModal.jsx / ConfirmModal.jsx. Reached only from Settings.

import { useEffect, useRef, useState } from 'react';
import { useModalBackdrop } from './modalBackdrop.js';
import { supabase } from '../lib/supabaseClient.js';
import { ACHIEVEMENTS } from '../data/achievements.js';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function AchievementsModal({ open, onClose }) {
  const doneRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);
  const [loading, setLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(/** @type {Record<string, string>} */ ({}));

  // Keep the latest close handler in a ref so the open-effect depends only on
  // `open` and runs exactly once per open (not on an unstable callback identity).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    doneRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Fetch the user's unlocked achievements each time the modal opens. A null
  // client (missing env / offline) or any error is treated as "nothing unlocked"
  // — never an error state, since this is display-only.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setUnlocked({});

    const run = async () => {
      if (!supabase) {
        if (!cancelled) setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('achievements_unlocked')
        .select('achievement_id, unlocked_at');
      if (cancelled) return;
      if (!error && data) {
        const map = {};
        for (const row of data) map[row.achievement_id] = row.unlocked_at;
        setUnlocked(map);
      }
      setLoading(false);
    };
    run();

    return () => {
      cancelled = true;
    };
  }, [open]);

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

  const panel = {
    background: 'var(--card-face-bg)',
    color: 'var(--card-text-black)',
    border: 'var(--card-border)',
    borderRadius: 'var(--card-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(90vw, 380px)',
    maxWidth: '100%',
  };

  const formatDate = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Achievements"
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
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Achievements</h2>

        {loading ? (
          <div style={{ opacity: 0.8, fontSize: 14, marginBottom: 16 }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
            {ACHIEVEMENTS.map((a) => {
              const earnedAt = unlocked[a.id];
              const isUnlocked = Boolean(earnedAt);
              return (
                <div
                  key={a.id}
                  style={{
                    border: '1px solid var(--card-border)',
                    borderRadius: 'var(--card-radius)',
                    padding: '10px 12px',
                    opacity: isUnlocked ? 1 : 0.5,
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{a.name}</div>
                  <div style={{ fontSize: 13, margin: '2px 0 4px' }}>{a.description}</div>
                  <div style={{ fontSize: 12, fontStyle: isUnlocked ? 'normal' : 'italic' }}>
                    {isUnlocked ? `Unlocked ${formatDate(earnedAt)}` : 'Locked'}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            ref={doneRef}
            style={{ ...btn, background: 'var(--ui-modal-btn-bg-strong)' }}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
