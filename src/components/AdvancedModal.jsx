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

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import { useGameStore } from '../hooks/useGameStore.js';
import { deal } from '../core/dealer.js';
import { buildSolvitaireText } from '../core/solvitaire.js';
import { buildSnapshotText, snapshotModeToken } from '../core/snapshot.js';
import { supabase } from '../lib/supabaseClient.js';
import { db, setSetting } from '../db/schema.js';
import { resetStats } from '../db/stats.js';
import { savePlayedSeeds } from '../db/playedSeeds.js';
import { clearUsedRandomSeeds } from '../db/usedRandomSeeds.js';
import { clearSeedCache } from '../db/seedCache.js';
import { clearActiveSession } from '../db/activeSession.js';
import { clearQueuedOps } from '../db/syncQueue.js';
import { useStatisticsStore } from '../hooks/useStatisticsStore.js';
import { useSeedStore } from '../hooks/useSeedStore.js';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { cancelWinCascade } from '../render/animation/winCascade.js';
import { cancelAllSolves } from '../core/solverClient.js';
import { enqueue } from '../sync/syncEngine.js';
import { getDeviceId } from '../sync/sessionPersistence.js';

// Upper bound for the remote leg. The local wipe is fast; the RPC decides how
// long the spinner can run before we surface a timeout error with a Retry.
const FACTORY_RESET_TIMEOUT_MS = 15000;

// localStorage keys that hold user progress (not display settings). Settings
// mirrors (klondike:theme, klondike:language, …) are deliberately preserved.
const LS_PROGRESS_PREFIXES = [
  'klondike:eventLastSelection:',
  'klondike:eventLastViewedPage:',
];
const LS_PROGRESS_KEYS = [
  'klondike:dailyLastSelection',
  'klondike:dissolveSeen',
];

function clearProgressLocalStorage() {
  try {
    if (typeof localStorage === 'undefined') return;
    for (const key of LS_PROGRESS_KEYS) localStorage.removeItem(key);
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && LS_PROGRESS_PREFIXES.some((p) => k.startsWith(p))) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* storage may be unavailable; Dexie remains the source of truth */
  }
}

function cancelOngoingDeal() {
  try {
    cancelAllSolves();
  } catch {}
  try {
    cancelWinCascade();
  } catch {}
  try {
    const ui = useUiStore.getState();
    ui.clearAllTransitions();
    ui.closeWinDialog();
    ui.setNoMovesDialogOpen(false);
    ui.setGameOverDialogOpen(false);
    ui.clearHints();
    ui.dismissNoHintsBanner();
  } catch {}
}

async function wipeLocalUserData() {
  // Drop the offline outbox first so stale ops can't re-push wiped state.
  await clearQueuedOps();
  await resetStats();
  await savePlayedSeeds([]);
  await db.dailyResults.clear();
  await clearUsedRandomSeeds();
  await clearSeedCache();
  await db.eventCatalogCache.clear();
  await db.eventImageCache.clear();
  await db.games.clear();
  // Seen badges reference wiped owned items / achievements; prefs stay.
  await setSetting('seenThemeItemIds', []);
  await setSetting('seenAchievementIds', []);
  clearProgressLocalStorage();
}

async function refreshInMemoryState() {
  await useStatisticsStore.getState().init();
  await useSeedStore.getState().init();
  // Wallet + ownership reflect the wiped server state; identity (display
  // name) is preserved and stays as-is.
  useAuthStore.setState({ coins: 0, coinsEarnedTotal: 0, coinsSpentTotal: 0, ownedItemIds: [] });
  try {
    useSettingsStore.getState().clearAchievementsSeen();
  } catch {}
  try {
    useSettingsStore.setState({ seenThemeItemIds: new Set() });
  } catch {}
  // Clear the saved session last (store inits above can re-save it via the
  // session-persistence subscriber) and mirror the delete remotely. The
  // shared dedupe key collapses any still-queued save behind this clear.
  await clearActiveSession();
  try {
    await enqueue('clear_game_session', { device_id: getDeviceId() }, 'game_session');
  } catch {
    /* deviceId not ready — local row already cleared */
  }
}

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
      cancelOngoingDeal();
      const work = (async () => {
        await wipeLocalUserData();
        if (!supabase) throw new Error(t('advanced.errors.offline'));
        const { error } = await supabase.rpc('factory_reset');
        if (error) throw error;
        await refreshInMemoryState();
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
              <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.45 }}>
                {t('advanced.description')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                style={fullWidthBtn}
                disabled={blocked}
                onClick={handleTakeSnapshot}
              >
                {t('mainMenu.takeSnapshot')}
              </button>
              <button
                type="button"
                style={fullWidthBtn}
                disabled={blocked}
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
