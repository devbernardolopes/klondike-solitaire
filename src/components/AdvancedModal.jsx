// components/AdvancedModal.jsx
// Danger-zone dialog launched from the Main Menu ("Advanced" button, below
// "Store"). Holds the Factory Reset affordance: wipes all of the signed-in
// user's progress locally (Dexie, except the settings table) and remotely
// (Supabase factory_reset() RPC) while keeping the session signed in and the
// language/display settings intact.
//
// While the reset is running the modal is non-dismissable (no backdrop tap,
// no Escape, no X) and shows a spinner; a timeout bounds the wait. On success
// a "Refresh page" button is offered (recommended) alongside Close.

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import ToggleSwitch from './ToggleSwitch.jsx';
import { useGameStore } from '../hooks/useGameStore.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { getCachedEventDetailSync } from '../repo/specialEventsRepository.js';
import { deal } from '../core/dealer.js';
import { buildSolvitaireText } from '../core/solvitaire.js';
import { buildSnapshotText, snapshotModeToken } from '../core/snapshot.js';
import { supabase } from '../lib/supabaseClient.js';
import { setSetting } from '../db/schema.js';
import {
  cancelOngoingDeal,
  fetchRemoteResetAt,
  refreshInMemoryState,
  wipeLocalUserData,
  LAST_APPLIED_RESET_KEY,
} from '../sync/factoryReset.js';

// Upper bound for the remote leg. The local wipe is fast; the RPC decides how
// long the spinner can run before we surface a timeout error with a Retry.
const FACTORY_RESET_TIMEOUT_MS = 15000;

function withTimeout(promise, ms) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.finally
    ? Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
    : Promise.race([promise, timeout]).then(
        (v) => {
          clearTimeout(timer);
          return v;
        },
        (e) => {
          clearTimeout(timer);
          throw e;
        },
      );
}

/**
 * Resolve the event-sequential Deal N for the deal label. Prefers the number
 * carried on the deal itself; falls back to the in-memory cached event detail
 * (covers sessions restored from a pre-number replaySpec, where the deal id
 * survived but the number did not). Returns '…' when unknown so the localized
 * "Special Event, Deal N (seed)" shape still renders.
 * @param {string|null} eventId
 * @param {number|null} dealId
 * @param {number|null} dealNumber
 */
function resolveEventDealNumber(eventId, dealId, dealNumber) {
  if (dealNumber != null) return dealNumber;
  try {
    if (eventId && dealId != null) {
      const detail = getCachedEventDetailSync(eventId);
      for (const p of detail?.pages || []) {
        const found = (p.deals || []).find((d) => d.id === dealId);
        if (found && found.dealNumber != null) return found.dealNumber;
      }
    }
  } catch {}
  return '…';
}

// Double-click / double-tap detector for the deal label to open the
// "Enter Seed" dialog. A pointer-based detector (mirroring Board's double-tap
// logic) makes touch taps work too, since browsers don't synthesize dblclick
// for touch.
const SEED_LABEL_DOUBLE_MS = 300;
const SEED_LABEL_DOUBLE_DIST = 24;

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function AdvancedModal({ open, onClose }) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | working | done | error
  const [errorMsg, setErrorMsg] = useState(null);
  const blocked = phase === 'working';

  // Live deal identity for the label at the top: hook subscriptions (not
  // getState snapshots) so session restore after reload pops the label in
  // while the modal is already open. `currentGameKind` is null until a deal
  // exists or the persisted session is restored.
  const seed = useGameStore((s) => s.state.seed);
  const tableau = useGameStore((s) => s.state.tableau);
  const currentGameKind = useUiStore((s) => s.currentGameKind);
  const currentDailyDate = useUiStore((s) => s.currentDailyDate);
  const currentEventDealId = useUiStore((s) => s.currentEventDealId);
  const currentEventDealNumber = useUiStore((s) => s.currentEventDealNumber);
  const currentEventId = useUiStore((s) => s.currentEventId);
  const hasDeal = Array.isArray(tableau) && tableau.some((p) => p.length > 0);
  // Preference toggles relocated here from the Settings modal. Same store
  // subscriptions and setters — no persistence changes: pinLastEvent is a
  // Dexie-backed useSettingsStore key, leaderboardVisible an optimistic
  // Supabase-RPC value in useAuthStore.
  const pinLastEvent = useSettingsStore((s) => s.pinLastEvent);
  const leaderboardVisible = useAuthStore((s) => s.leaderboardVisible);
  const setLeaderboardVisible = useAuthStore((s) => s.setLeaderboardVisible);

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
      useUiStore.getState().setSeedInputDialogOpen(true);
    }
  }, []);

  useModalEscape({ open, onClose, id: 'advanced', z: Z.CHILD, enabled: !blocked });

  useEffect(() => {
    if (!open) return;
    if (!blocked) dialogRef.current?.focus();
  }, [open, blocked]);

  // Reset transient state whenever the modal is dismissed so reopening never
  // resurfaces a stale done/error screen.
  useEffect(() => {
    if (!open) {
      setConfirmOpen(false);
      setPhase('idle');
      setErrorMsg(null);
    }
  }, [open ]);

  if (!open) return null;

  // Local timestamp as YYYYMMDD-HHMMSS (no separators, sortable).
  const formatTimestamp = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
      `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    );
  };

  const handleTakeSnapshot = () => {
    const state = useGameStore.getState().state;
    const text = buildSnapshotText(state);
    const filename = `${formatTimestamp(new Date())}_${snapshotModeToken(state)}.txt`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    useUiStore.getState().setAnnounce(t('mainMenu.announce.snapshotExported'));
  };

  // Export the START configuration of the current deal as a Solvitaire-format
  // file. Unlike "Take Snapshot" this always uses the initial deal (rebuilt from
  // the store's replaySpec) and exposes every card (no face-down placeholders).
  const handleExportSolvitaire = () => {
    const { replaySpec, state } = useGameStore.getState();
    const initial = deal({ ...replaySpec, drawCount: state.drawCount });
    const text = buildSolvitaireText(initial);
    const filename = `solvitaire_${snapshotModeToken(state)}_${formatTimestamp(new Date())}.txt`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    useUiStore.getState().setAnnounce(t('mainMenu.announce.solvitaireExported'));
  };

  const runFactoryReset = async () => {
    setConfirmOpen(false);
    setErrorMsg(null);
    setPhase('working');
    try {
      const work = (async () => {
        await cancelOngoingDeal();
        await wipeLocalUserData();
        if (!supabase) throw new Error(t('advanced.errors.offline'));
        const { error } = await supabase.rpc('factory_reset');
        if (error) throw error;
        await refreshInMemoryState();
        // Remember the marker this reset stamped so this device doesn't
        // self-wipe again on the next pull (other devices pick it up there).
        try {
          const marker = await fetchRemoteResetAt();
          await setSetting(LAST_APPLIED_RESET_KEY, marker ?? new Date().toISOString());
        } catch {}
      })();
      await withTimeout(work, FACTORY_RESET_TIMEOUT_MS);
      setPhase('done');
    } catch (e) {
      const msg =
        e?.message === 'timeout'
          ? t('advanced.errors.timeout')
          : (e?.message || t('advanced.errors.failed'));
      setErrorMsg(msg);
      setPhase('error');
    }
  };

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
  const dangerBtn = {
    ...btn,
    background: 'var(--ui-modal-btn-bg-danger, #b23b3b)',
    color: '#fff',
  };
  const strongBtn = {
    ...btn,
    background: 'var(--ui-modal-btn-bg-strong)',
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
  };

  const fullWidthBtn = {
    ...btn,
    width: '100%',
    padding: '10px 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  };

  const field = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  };

  return (
    <>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('advanced.title')}
        aria-busy={blocked}
        tabIndex={-1}
        {...(blocked ? {} : backdrop)}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: Z.CHILD,
          padding: 16,
        }}
      >
        <style>{'@keyframes klondike-spin { to { transform: rotate(360deg); } }'}</style>
        <div style={panel}>
          <h2 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>
            {t('advanced.title')}
          </h2>
          {!blocked && <ModalCloseButton onClick={onClose} />}

          {phase === 'done' ? (
            <>
              <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.45 }}>
                {t('advanced.done.message')}
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button type="button" style={btn} onClick={onClose}>
                  {t('common.close')}
                </button>
                <button
                  type="button"
                  style={strongBtn}
                  onClick={() => window.location.reload()}
                >
                  {t('advanced.refresh')}
                </button>
              </div>
            </>
          ) : phase === 'error' ? (
            <>
              <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.45 }}>
                {errorMsg || t('advanced.errors.failed')}
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button type="button" style={btn} onClick={onClose}>
                  {t('common.close')}
                </button>
                <button
                  type="button"
                  style={strongBtn}
                  onClick={() => window.location.reload()}
                >
                  {t('advanced.refresh')}
                </button>
                <button
                  type="button"
                  style={dangerBtn}
                  onClick={runFactoryReset}
                >
                  {t('advanced.retry')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ textAlign: 'center', margin: '0 0 12px', minHeight: 20 }}>
                {currentGameKind ? (
                  <span
                    role="button"
                    tabIndex={0}
                    title={t('toolbar.seedHint')}
                    onDoubleClick={onLabelActivate}
                    onPointerUp={onLabelActivate}
                    onKeyDown={onLabelActivate}
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      userSelect: 'none',
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    {currentGameKind === 'daily'
                      ? t('toolbar.dailyChallenge', { date: currentDailyDate, seed })
                      : currentGameKind === 'random'
                        ? t('toolbar.random', { seed })
                        : currentGameKind === 'event'
                          ? t('toolbar.specialEvent', { dealNumber: resolveEventDealNumber(currentEventId, currentEventDealId, currentEventDealNumber), seed })
                          : t('toolbar.winningDeal', { seed })}
                  </span>
                ) : (
                  <span aria-hidden="true">{'\u00A0'}</span>
                )}
              </div>
              <div style={{ ...field, margin: '0 0 10px', opacity: blocked ? 0.5 : 1 }}>
                <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.pinLastEvent')}</label>
                <ToggleSwitch
                  checked={!!pinLastEvent}
                  onChange={(v) => useSettingsStore.getState().setPinLastEvent(v)}
                  label={t('settings.pinLastEvent.desc')}
                  disabled={blocked}
                />
              </div>
              <div style={{ ...field, margin: '0 0 12px', opacity: (blocked || !supabase) ? 0.5 : 1 }}>
                <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.appearLeaderboard')}</label>
                <ToggleSwitch
                  checked={!!leaderboardVisible}
                  onChange={(v) => setLeaderboardVisible(v)}
                  label={t('settings.appearLeaderboard')}
                  disabled={blocked || !supabase}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                style={{ ...fullWidthBtn, ...(!hasDeal || blocked ? { opacity: 0.5, cursor: 'not-allowed' } : null) }}
                disabled={blocked || !hasDeal}
                onClick={handleTakeSnapshot}
              >
                {t('mainMenu.takeSnapshot')}
              </button>
              <button
                type="button"
                style={{ ...fullWidthBtn, ...(!hasDeal || blocked ? { opacity: 0.5, cursor: 'not-allowed' } : null) }}
                disabled={blocked || !hasDeal}
                onClick={handleExportSolvitaire}
              >
                {t('mainMenu.export')}
              </button>
              <button
                type="button"
                style={{
                  ...dangerBtn,
                  width: '100%',
                  padding: '10px 14px',
                  cursor: blocked ? 'not-allowed' : 'pointer',
                  opacity: blocked ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                }}
                disabled={blocked}
                onClick={() => setConfirmOpen(true)}
              >
                {blocked && (
                  <span
                    role="status"
                    aria-label={t('advanced.working')}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      border: '2px solid rgba(255,255,255,0.4)',
                      borderTopColor: '#fff',
                      animation: 'klondike-spin 0.8s linear infinite',
                    }}
                  />
                )}
                {blocked ? t('advanced.working') : t('advanced.factoryReset')}
              </button>
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        zIndex={Z.GRANDCHILD}
        z={Z.GRANDCHILD}
        title={t('advanced.confirm.title')}
        message={t('advanced.confirm.message')}
        confirmText={t('advanced.confirm.confirm')}
        cancelText={t('common.cancel')}
        onConfirm={runFactoryReset}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
