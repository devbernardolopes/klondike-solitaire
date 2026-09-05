// components/HistoryDetailModal.jsx
// Detail view for a single game-history entry, launched on top of
// HistoryModal. Shows every field available for the deal: result, kind (or
// event title), date played, score, moves, duration, undos, seed, and the
// move breakdown. Stacks above History (Z.GRANDCHILD) so Escape and
// outside-click dismiss only this modal and return to the still-open list.
// Shares the close-button / backdrop / escape chrome of the other modals.

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { formatTime } from '../utils/formatTime.js';

/**
 * @param {object} props
 * @param {object|null} props.entry  history entry (see gameHistoryRepository.js)
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function HistoryDetailModal({ entry, open, onClose }) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);

  useModalEscape({ open, onClose, id: 'history-detail', z: Z.GRANDCHILD });

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
  }, [open]);

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

  const formatDateTime = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  };

  const kindLabel = entry.eventTitle
    ?? (entry.gameKind ? t(`history.kinds.${entry.gameKind}`, { defaultValue: entry.gameKind }) : t('history.kinds.unknown'));

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
          {rows.map(([k, v]) => (
            <div key={k} style={row}>
              <span style={label}>{k}</span>
              <span style={value}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
