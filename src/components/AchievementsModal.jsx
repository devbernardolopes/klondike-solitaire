// components/AchievementsModal.jsx
// Read-only display of achievements. The catalog is pulled from Supabase's
// achievements_definitions table (data-driven — Bernardo manages rows directly)
// and the user's unlocked set from achievements_unlocked. This is display only
// — it gates nothing, and a failed/offline fetch simply shows an empty catalog
// with nothing unlocked (never an error state). Mirrors the visual chrome
// (panel/backdrop, focus-on-open, Escape/backdrop-to-close) of
// SettingsModal.jsx / ConfirmModal.jsx. Reached only from Settings.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { achievementImageUrl, onAchievementImageError } from '../utils/achievementImage.js';
import AchievementDetailModal from './AchievementDetailModal.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';

/**
 * A single achievement entry in the compact list. Unlocked entries are
 * clickable (open the detail modal on click / Enter / Space) and keyboard
 * focusable. Locked entries are inert: dimmed, removed from the tab order, and
 * not activatable. Hover/focus backgrounds are tracked with local state (no
 * theme-CSS changes needed).
 */
const NEW_BADGE = {
  position: 'absolute',
  top: 4,
  left: 4,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
  color: '#fff',
  background: 'var(--card-text-red, #d12b3b)',
  borderRadius: 4,
  padding: '2px 5px',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
};

function AchievementRow({ achievement, isNew, onOpen }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const unlocked = Boolean(achievement.earnedAt);
  const active = (hover || focus) && unlocked;
  return (
    <div
      style={{
        position: 'relative',
        border: '1px solid var(--ui-modal-panel-border)',
        borderRadius: 'var(--ui-modal-panel-radius)',
        padding: '10px 12px',
        opacity: unlocked ? 1 : 0.5,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        cursor: unlocked ? 'pointer' : 'default',
        background: active ? 'var(--ui-modal-btn-bg)' : 'transparent',
        outline: focus ? '2px solid var(--ui-modal-btn-border)' : 'none',
        outlineOffset: 1,
      }}
      {...(unlocked
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': achievement.name,
            onClick: () => onOpen(achievement),
            onKeyDown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(achievement);
              }
            },
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            onFocus: () => setFocus(true),
            onBlur: () => setFocus(false),
          }
        : { 'aria-disabled': true })}
    >
      <img
        src={achievementImageUrl(achievement.image_path)}
        alt=""
        onError={onAchievementImageError}
        style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flex: '0 0 auto' }}
      />
      {isNew && <span style={NEW_BADGE}>New</span>}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{achievement.name}</span>
        </div>
        <div style={{ fontSize: 13, margin: '2px 0 0' }}>{achievement.description}</div>
      </div>
    </div>
  );
}


/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function AchievementsModal({ open, onClose }) {
  const dialogRef = useRef(null);
  const scrollRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);
  const userId = useAuthStore((s) => s.userId);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [defs, setDefs] = useState(/** @type {any[]} */ ([]));
  const [unlocked, setUnlocked] = useState(/** @type {Record<string, string>} */ ({}));
  const [selected, setSelected] = useState(/** @type {any|null} */ (null));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newIds, setNewIds] = useState(/** @type {string[]} */ ([]));
  const [scrollMetrics, setScrollMetrics] = useState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
  const markAchievementsSeen = useSettingsStore((s) => s.markAchievementsSeen);

  // Keep the latest close handler in a ref so the open-effect depends only on
  // `open` and runs exactly once per open (not on an unstable callback identity).
  useModalEscape({ open, onClose, id: 'achievements', z: Z.CHILD });

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setScrollMetrics({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
      return undefined;
    }

    const scrollElement = scrollRef.current;
    if (!scrollElement) return undefined;

    const updateScrollMetrics = () => {
      setScrollMetrics({
        scrollTop: scrollElement.scrollTop,
        scrollHeight: scrollElement.scrollHeight,
        clientHeight: scrollElement.clientHeight,
      });
    };

    scrollElement.addEventListener('scroll', updateScrollMetrics, { passive: true });
    window.addEventListener('resize', updateScrollMetrics);
    updateScrollMetrics();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateScrollMetrics)
      : null;
    resizeObserver?.observe(scrollElement);

    return () => {
      scrollElement.removeEventListener('scroll', updateScrollMetrics);
      window.removeEventListener('resize', updateScrollMetrics);
      resizeObserver?.disconnect();
    };
  }, [open, loading, defs, unlocked]);

  // Fetch the catalog (achievements_definitions) and the user's unlocked set.
  // A null client (missing env / offline) or any error is treated as
  // "nothing unlocked / empty catalog" — never an error state, since this is
  // display-only. Exposed as `load` so it can be re-run after a reset to
  // refresh the unlocked set without closing the modal.
  const dismissNew = useCallback(
    (id) => {
      if (!id) return;
      setNewIds((prev) => {
        if (!prev.includes(id)) return prev;
        return prev.filter((x) => x !== id);
      });
      markAchievementsSeen([id]);
    },
    [markAchievementsSeen],
  );

  const load = useCallback(async (cancelledRef) => {
    if (!open) return;
    setLoading(true);
    setLoaded(false);
    setDefs([]);
    setUnlocked({});

    if (!supabase) {
      if (!cancelledRef.current) {
        setLoaded(false);
        setLoading(false);
      }
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
    if (cancelledRef.current) return;
    const defsOk = !defsRes.error && defsRes.data;
    const unlockedOk = !unlockedRes.error && unlockedRes.data;
    if (defsOk) {
      setDefs(defsRes.data);
    }
    let nextUnlocked = {};
    if (unlockedOk) {
      const map = {};
      for (const row of unlockedRes.data) map[row.achievement_id] = row.unlocked_at;
      setUnlocked(map);
      nextUnlocked = map;
    }
    if (defsOk && unlockedOk) {
      const seen = useSettingsStore.getState().seenAchievementIds;
      const fresh = Object.keys(nextUnlocked).filter((id) => !seen.includes(id));
      setNewIds(fresh);
      if (fresh.length) markAchievementsSeen(fresh);
    } else {
      setNewIds([]);
    }
    setLoaded(defsOk && unlockedOk);
    setLoading(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const cancelledRef = { current: false };
    load(cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
  }, [open]);

  // Delete all of the user's unlocked achievements via the privileged
  // reset_achievements() RPC, then re-fetch so every row flips to locked.
  // Best-effort: swallow any error and just refresh — this is display-only.
  const handleReset = async () => {
    setConfirmOpen(false);
    if (!supabase || !userId) return;
    setResetting(true);
    try {
      await supabase.rpc('reset_achievements');
    } catch {
      // Offline / RPC missing — fall through to a refresh anyway.
    }
    useSettingsStore.getState().clearAchievementsSeen();
    setNewIds([]);
    await load({ current: false });
    setResetting(false);
  };

  if (!open) return null;

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
  const showScrollUp = scrollMetrics.scrollTop > 0;
  const showScrollDown =
    scrollMetrics.scrollTop + scrollMetrics.clientHeight < scrollMetrics.scrollHeight - 1;
  const scrollButton = {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 34,
    height: 28,
    display: 'grid',
    placeItems: 'center',
    padding: 0,
    border: '1px solid var(--ui-modal-panel-border)',
    borderRadius: 999,
    background: 'color-mix(in srgb, var(--ui-modal-panel-bg) 82%, transparent)',
    color: 'var(--ui-modal-panel-fg)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
    backdropFilter: 'blur(4px)',
    cursor: 'pointer',
    zIndex: 1,
  };

  return (
    <>
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

          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
            <div ref={scrollRef} className="modal-body-scroll" style={{ height: '100%' }}>
            {loading ? (
              <div style={{ opacity: 0.8, fontSize: 14, marginBottom: 16 }}>Loading…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
                {defs.map((a) => {
                  const isNew = Boolean(unlocked[a.id]) && newIds.includes(a.id);
                  return (
                    <AchievementRow
                      key={a.id}
                      achievement={{ ...a, earnedAt: unlocked[a.id] ?? null }}
                      isNew={isNew}
                      onOpen={(row) => {
                        if (newIds.includes(row.id)) dismissNew(row.id);
                        setSelected(row);
                      }}
                    />
                  );
                })}
              </div>
            )}
            </div>

            {showScrollUp && (
              <button
                type="button"
                aria-label="Scroll achievements to top"
                onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                style={{ ...scrollButton, top: 8 }}
              >
                <ChevronUp size={18} strokeWidth={2.5} aria-hidden="true" />
              </button>
            )}
            {showScrollDown && (
              <button
                type="button"
                aria-label="Scroll achievements to bottom"
                onClick={() => {
                  const element = scrollRef.current;
                  element?.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
                }}
                style={{ ...scrollButton, bottom: 8 }}
              >
                <ChevronDown size={18} strokeWidth={2.5} aria-hidden="true" />
              </button>
            )}
          </div>

          {loaded && Object.keys(unlocked).length > 0 && (
            <button
              type="button"
              disabled={resetting}
              onClick={() => setConfirmOpen(true)}
              style={{
                marginTop: 12,
                padding: '10px 14px',
                borderRadius: 6,
                border: '1px solid var(--ui-modal-btn-border)',
                background: 'var(--ui-modal-btn-bg-danger, #b23b3b)',
                color: '#fff',
                cursor: resetting ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {resetting ? 'Resetting…' : 'Reset Achievements'}
            </button>
          )}
        </div>
      </div>

      <AchievementDetailModal
        achievement={selected}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      />

      <ConfirmModal
        open={confirmOpen}
        zIndex={Z.GRANDCHILD}
        z={Z.GRANDCHILD}
        title="Reset Achievements?"
        message="This will clear all of your unlocked achievements. They can be earned again by playing."
        confirmText="Reset"
        cancelText="Cancel"
        onConfirm={handleReset}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
