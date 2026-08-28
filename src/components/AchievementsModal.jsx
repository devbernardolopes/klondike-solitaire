// components/AchievementsModal.jsx
// Read-only display of achievements. The catalog is pulled from Supabase's
// achievements_definitions table (data-driven — Bernardo manages rows directly)
// and the user's unlocked set from achievements_unlocked. This is display only
// — it gates nothing, and a failed/offline fetch simply shows an empty catalog
// with nothing unlocked (never an error state). Mirrors the visual chrome
// (panel/backdrop, focus-on-open, Escape/backdrop-to-close) of
// SettingsModal.jsx / ConfirmModal.jsx. Reached only from Settings.

import { useEffect, useRef, useState } from 'react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { achievementImageUrl, onAchievementImageError } from '../utils/achievementImage.js';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function AchievementsModal({ open, onClose }) {
  const dialogRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);
  const [loading, setLoading] = useState(true);
  const [defs, setDefs] = useState(/** @type {any[]} */ ([]));
  const [unlocked, setUnlocked] = useState(/** @type {Record<string, string>} */ ({}));

  // Keep the latest close handler in a ref so the open-effect depends only on
  // `open` and runs exactly once per open (not on an unstable callback identity).
  useModalEscape({ open, onClose, id: 'achievements', z: Z.CHILD });

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
  }, [open]);

  // Fetch the catalog (achievements_definitions) and the user's unlocked set
  // each time the modal opens. A null client (missing env / offline) or any
  // error is treated as "nothing unlocked / empty catalog" — never an error
  // state, since this is display-only.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setDefs([]);
    setUnlocked({});

    const run = async () => {
      if (!supabase) {
        if (!cancelled) setLoading(false);
        return;
      }
      const [defsRes, unlockedRes] = await Promise.all([
        supabase
          .from('achievements_definitions')
          .select('id, name, description, image_path, sort_order')
          .eq('enabled', true)
          .order('sort_order'),
        supabase
          .from('achievements_unlocked')
          .select('achievement_id, unlocked_at'),
      ]);
      if (cancelled) return;
      if (!defsRes.error && defsRes.data) {
        setDefs(defsRes.data);
      }
      if (!unlockedRes.error && unlockedRes.data) {
        const map = {};
        for (const row of unlockedRes.data) map[row.achievement_id] = row.unlocked_at;
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

  const panel = {
    position: 'relative',
    background: 'var(--card-face-bg)',
    color: 'var(--card-text-black)',
    border: 'var(--card-border)',
    borderRadius: 'var(--card-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(90vw, 380px)',
    maxWidth: '100%',
    height: '85vh',
    display: 'flex',
    flexDirection: 'column',
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
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>Achievements</h2>
        <ModalCloseButton onClick={onClose} />

        <div className="modal-body-scroll" style={{ flex: 1, minHeight: 0 }}>
          {loading ? (
            <div style={{ opacity: 0.8, fontSize: 14, marginBottom: 16 }}>Loading…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
              {defs.map((a) => {
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
                      display: 'flex',
                      gap: 12,
                      alignItems: 'flex-start',
                    }}
                  >
                    <img
                      src={achievementImageUrl(a.image_path)}
                      alt=""
                      onError={onAchievementImageError}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 6,
                        objectFit: 'cover',
                        flex: '0 0 auto',
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{a.name}</div>
                      <div style={{ fontSize: 13, margin: '2px 0 4px' }}>{a.description}</div>
                      <div style={{ fontSize: 12, fontStyle: isUnlocked ? 'normal' : 'italic' }}>
                        {isUnlocked ? `Unlocked ${formatDate(earnedAt)}` : 'Locked'}
                      </div>
                    </div>
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
