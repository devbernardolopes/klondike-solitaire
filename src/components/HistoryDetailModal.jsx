// components/HistoryDetailModal.jsx
// Detail view for a single game-history entry, launched on top of
// HistoryModal. Shows every field available for the deal: result, kind (or
// event title), date played, score, moves, duration, undos, seed, and the
// move breakdown. The seed value is tappable (copies to clipboard with a
// toast) and a Play button re-deals the exact seed, kind-preserving, through
// the store's dealFavorite router (daily stays daily, live events stay
// events, everything else re-deals the identical shuffle). Stacks above
// History (Z.GRANDCHILD) so Escape and outside-click dismiss only this modal
// and return to the still-open list. Shares the close-button / backdrop /
// escape chrome of the other modals.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Play } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { useGameStore } from '../hooks/useGameStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { usePlaybackStore } from '../hooks/usePlaybackStore.js';
import { useToastStore, TOAST_PRIORITY } from '../hooks/useToastStore.js';
import { fetchMoveLog } from '../repo/gameHistoryRepository.js';
import { copyText } from '../utils/copyText.js';
import { Z } from '../utils/modalStack.js';
import ConfirmModal from './ConfirmModal.jsx';
import ModalCloseButton from './ModalCloseButton.jsx';
import { formatTime } from '../utils/formatTime.js';
import { formatHistoryDate } from '../utils/formatHistoryDate.js';
import { eventDealTitle } from '../utils/eventDealTitle.js';

/**
 * @param {object} props
 * @param {object|null} props.entry  history entry (see gameHistoryRepository.js)
 * @param {boolean} props.open
 * @param {() => void} props.onClose  close this detail view only
 * @param {() => void} [props.onExitToGame]  close detail + list + settings
 *   (used by the re-deal action so the fresh deal lands on a bare board)
 */
export default function HistoryDetailModal({ entry, open, onClose, onExitToGame }) {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);

  useModalEscape({ open, onClose, id: 'history-detail', z: Z.GRANDCHILD });

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
  }, [open]);

  // The list reads skip move_log (page weight), so fetch this game's
  // recording when the detail view opens. Pending (unflushed) results
  // resolve from the local outbox inside fetchMoveLog. The button is
  // optimistically enabled while the fetch is in flight (status 'unknown')
  // so it never flashes disabled→enabled; the fetch only ever downgrades to
  // 'missing'. The confirm path awaits the same promise, closing the race
  // where the user taps Playback before the fetch lands.
  const [logState, setLogState] = useState({ status: 'unknown', moveLog: null });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBlocked, setConfirmBlocked] = useState(false);
  const logPromiseRef = useRef(null);
  useEffect(() => {
    if (!open || !entry) return;
    let cancelled = false;
    setLogState({ status: 'unknown', moveLog: null });
    setConfirmOpen(false);
    if (entry.seed == null || entry.gameId == null) {
      logPromiseRef.current = Promise.resolve(null);
      setLogState({ status: 'missing', moveLog: null });
      return undefined;
    }
    logPromiseRef.current = fetchMoveLog(entry.gameId).then(
      ({ moveLog }) => {
        const log = typeof moveLog === 'string' && moveLog.length > 0 ? moveLog : null;
        if (!cancelled) setLogState(log ? { status: 'ready', moveLog: log } : { status: 'missing', moveLog: null });
        return log;
      },
      () => {
        if (!cancelled) setLogState({ status: 'missing', moveLog: null });
        return null;
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, entry]);

  if (!open || !entry) return null;

  const panel = {
    position: 'relative',
    background: 'var(--ui-modal-panel-bg)',
    color: 'var(--ui-modal-panel-fg)',
    border: 'var(--ui-modal-panel-border)',
    borderRadius: 'var(--ui-modal-panel-radius)',
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
    padding: '6px 0',
    borderBottom: '1px solid var(--ui-modal-panel-border)',
    fontSize: 14,
  };

  const label = { opacity: 0.75 };
  const value = { fontWeight: 600, textAlign: 'right' };

  // Tappable seed value (copies) + 44px re-deal button, mirroring the
  // toolbar touch-target minimum.
  const seedCopyBtn = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    padding: '6px 4px',
    background: 'none',
    border: 'none',
    color: 'inherit',
    font: 'inherit',
    fontWeight: 600,
    cursor: 'pointer',
    touchAction: 'manipulation',
  };
  const iconBtn = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    boxSizing: 'border-box',
    padding: 0,
    borderRadius: 8,
    border: '1px solid var(--ui-modal-panel-border)',
    background: 'transparent',
    color: 'var(--ui-modal-panel-fg)',
    cursor: 'pointer',
    touchAction: 'manipulation',
  };

  const formatDateTime = (iso) => {
    const date = formatHistoryDate(iso, i18n.language);
    if (date == null) return '';
    let time = '';
    try {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) time = d.toLocaleTimeString(i18n.language || 'en');
    } catch {
      time = '';
    }
    return time ? `${date} ${time}` : date;
  };

  const kindLabel = eventDealTitle(entry, t);
  const exitToGame = onExitToGame ?? onClose;
  const dealFavorite = useGameStore((s) => s.dealFavorite);

  // Tapping the seed value copies it; the toast (announced via ToastHost's
  // live region) is the confirmation — no inline label needed.
  const onCopySeed = async () => {
    if (entry.seed == null) return;
    let ok = false;
    try {
      ok = await copyText(entry.seed);
    } catch {
      ok = false;
    }
    try {
      useToastStore.getState().push(ok
        ? {
          name: t('toasts.seedCopied.title', { seed: entry.seed }),
          description: t('toasts.seedCopied.desc', { seed: entry.seed }),
          priority: TOAST_PRIORITY.DEFAULT,
        }
        : {
          name: t('toasts.seedCopyFailed.title'),
          description: t('toasts.seedCopyFailed.desc'),
          priority: TOAST_PRIORITY.DEFAULT,
        });
    } catch {}
  };

  // Re-deal this exact seed, kind-preserving, through the same router the
  // Favorites modal uses (daily replays via dealDaily, live events via
  // dealSpecialEventDeal with its stale-event fallback, everything else as
  // the identical shuffle of its stored kind). Same gate as every New-Game
  // entry point: an in-progress game is stashed behind the "discard current
  // game?" confirmation (which records a loss on confirm).
  const onReplayDeal = () => {
    if (entry.seed == null) return;
    const action = () => {
      exitToGame();
      dealFavorite(entry);
    };
    if (useStatsStore.getState().isInProgress()) {
      useUiStore.getState().setPendingStartDeal(action);
      useUiStore.getState().setConfirmNewGameDialogOpen(true);
      onClose();
    } else {
      action();
    }
  };

  const canPlay = entry.seed != null && logState.status !== 'missing';
  const playDisabledReason =
    logState.status === 'unknown'
      ? t('playback.loading')
      : entry.seed == null
        ? t('playback.noSeed')
        : t('playback.noRecording');

  const onPlaybackClick = () => {
    // Playback only starts from an idle board. An in-progress game gets an
    // info-only dialog (no discard path) — the player finishes or abandons
    // it first via the normal New Game flow.
    setConfirmBlocked(useStatsStore.getState().isInProgress());
    setConfirmOpen(true);
  };

  const showPlaybackError = () => {
    try {
      useToastStore.getState().push({
        name: t('playback.errorTitle'),
        description: t('playback.errorMessage'),
        priority: TOAST_PRIORITY.DEFAULT,
      });
    } catch {}
  };

  const onPlaybackConfirm = async () => {
    setConfirmOpen(false);
    if (confirmBlocked) return;
    // The recording may still be in flight when the user confirms quickly —
    // await it rather than trusting the optimistic button state.
    let moveLog = logState.moveLog;
    if (moveLog == null) {
      try {
        moveLog = await logPromiseRef.current;
      } catch {
        moveLog = null;
      }
    }
    if (moveLog == null) {
      showPlaybackError();
      setLogState({ status: 'missing', moveLog: null });
      return;
    }
    try {
      usePlaybackStore.getState().start({
        seed: entry.seed,
        logText: moveLog,
        title: kindLabel,
      });
    } catch {
      showPlaybackError();
      return;
    }
    // Leave the menu stack entirely: closing Settings unmounts History +
    // this detail view along with it.
    onClose();
    useUiStore.getState().setSettingsDialogOpen(false);
  };

  const rows = [
    [t('history.detail.result'), entry.won ? t('history.won') : t('history.lost')],
    [t('history.detail.kind'), kindLabel],
    [t('history.detail.date'), formatDateTime(entry.createdAt)],
    [t('history.detail.score'), String(entry.score ?? 0)],
    [t('history.detail.moves'), entry.moves ?? t('history.na')],
    [t('history.detail.duration'), entry.durationMs == null ? t('history.na') : formatTime(entry.durationMs)],
    [t('history.detail.undos'), String(entry.undos ?? 0)],
    [t('history.detail.seed'), entry.seed ?? t('history.na')],
    [t('history.detail.hintUsed'), entry.hintUsed ? t('history.detail.yes') : t('history.detail.no')],
    [t('history.detail.undoUsed'), entry.undoUsed ? t('history.detail.yes') : t('history.detail.no')],
    [t('history.detail.tableauMoves'), String(entry.tableauToTableauMoves ?? 0)],
    [t('history.detail.foundationMoves'), String(entry.foundationMoves ?? 0)],
    [t('history.detail.foundationBackMoves'), String(entry.foundationToTableauMoves ?? 0)],
    [t('history.detail.recycles'), String(entry.recycleCount ?? 0)],
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('history.detail.title')}
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
        zIndex: Z.GRANDCHILD,
        padding: 16,
      }}
    >
      <div style={panel}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>
          {t('history.detail.title')}
        </h2>
        <ModalCloseButton onClick={onClose} />
        <div className="modal-body-scroll" style={{ maxHeight: '60vh' }}>
          {rows.map(([k, v]) => {
            if (k === t('history.detail.seed')) {
              return (
                <div key={k} style={row}>
                  <span style={label}>{k}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {entry.seed == null ? (
                      <span style={value}>{v}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={onCopySeed}
                        title={t('history.detail.copySeed', { seed: entry.seed })}
                        aria-label={t('history.detail.copySeed', { seed: entry.seed })}
                        style={seedCopyBtn}
                      >
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                        <Copy size={14} aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onReplayDeal}
                      title={t('history.detail.replayDeal')}
                      aria-label={t('history.detail.replayDeal')}
                      disabled={entry.seed == null}
                      style={{ ...iconBtn, opacity: entry.seed == null ? 0.4 : 1, cursor: entry.seed == null ? 'default' : 'pointer' }}
                    >
                      <Play size={18} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              );
            }
            return (
              <div key={k} style={k === t('history.detail.score') ? { ...row, display: 'none' } : row}>
                <span style={label}>{k}</span>
                <span style={value}>{v}</span>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          style={{
            width: '100%',
            marginTop: 14,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--ui-modal-panel-border)',
            background: canPlay ? 'var(--ui-modal-panel-fg)' : 'transparent',
            color: canPlay ? 'var(--ui-modal-panel-bg)' : 'var(--ui-modal-panel-fg)',
            opacity: canPlay ? 1 : 0.55,
            fontWeight: 700,
            fontSize: 14,
            cursor: canPlay ? 'pointer' : 'default',
          }}
          disabled={!canPlay}
          title={canPlay ? undefined : playDisabledReason}
          onClick={onPlaybackClick}
        >
          {t('playback.button')}
        </button>
        {!canPlay && logState.status !== 'unknown' && (
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6, textAlign: 'center' }}>
            {playDisabledReason}
          </div>
        )}
        <ConfirmModal
          open={confirmOpen}
          title={confirmBlocked ? t('playback.blockedTitle') : t('playback.confirmTitle')}
          message={confirmBlocked ? t('playback.blockedMessage') : t('playback.confirmMessage', { title: kindLabel })}
          confirmText={confirmBlocked ? t('playback.ok') : t('playback.start')}
          cancelText={t('playback.cancel')}
          hideCancel={confirmBlocked}
          onConfirm={onPlaybackConfirm}
          onCancel={() => setConfirmOpen(false)}
          zIndex={Z.GRANDCHILD}
          z={Z.GRANDCHILD}
        />
      </div>
    </div>
  );
}
