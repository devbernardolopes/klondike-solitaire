// components/SpecialEventsModal.jsx
// List of currently-visible Special Events as wide single-column buttons,
// styled to match the Main Menu's button list (SettingsModal.jsx's `btn` /
// NEW_BADGE_R conventions) rather than the old thumbnail-card grid. Reads
// the Phase 1 schema via repo/specialEventsRepository.js.
//
// Clicking an event still calls setEventDetailOpen(ev.id) — the hook
// EventDetailModal.jsx already listens on — but EventDetailModal.jsx itself
// is untouched this phase (it still speaks the OLD flat-seed-pool shape via
// core/specialEvents.js, which now resolves to an empty fallback since those
// tables are gone). So for now a click is a harmless no-op: nothing renders.
// That's expected and gets replaced in Phase 3, not a bug in this phase.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalBackdrop } from './modalBackdrop.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { fetchSpecialEvents, getCachedEventsSummarySync } from '../repo/specialEventsRepository.js';
import { translateSpecialEvent } from '../i18n/db.js';

export default function SpecialEventsModal() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.specialEventsOpen);
  const setOpen = useUiStore((s) => s.setSpecialEventsOpen);
  const setDetail = useUiStore((s) => s.setEventDetailOpen);

  const backdrop = useModalBackdrop(() => setOpen(false));
  useModalEscape({ open, onClose: () => setOpen(false), id: 'events', z: Z.CHILD });

  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    const cached = getCachedEventsSummarySync();
    if (cached) {
      setEvents(cached.map(translateSpecialEvent));
      setLoaded(true);
      fetchSpecialEvents()
        .then((fresh) => {
          const freshIds = fresh.map((e) => e.id).join('|');
          const cachedIds = cached.map((e) => e.id).join('|');
          const differ = freshIds !== cachedIds || fresh.some((f, i) => {
            const c = cached[i];
            return !c || f.totalPages !== c.totalPages || f.completedPages !== c.completedPages || f.fullyCompleted !== c.fullyCompleted;
          });
          if (differ) setEvents(fresh.map(translateSpecialEvent));
        })
        .catch(() => {})
        .finally(() => setLoaded(true));
      return;
    }
    setLoaded(false);
    fetchSpecialEvents()
      .then((evs) => setEvents(evs.map(translateSpecialEvent)))
      .catch(() => setEvents([]))
      .finally(() => setLoaded(true));
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
    textAlign: 'left',
    width: '100%',
    position: 'relative',
  };

  const panel = {
    position: 'relative',
    background: 'var(--ui-modal-panel-bg)',
    color: 'var(--ui-modal-panel-fg)',
    border: 'var(--ui-modal-panel-border)',
    borderRadius: 'var(--ui-modal-panel-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(94vw, 480px)',
    maxWidth: '100%',
    maxHeight: '85vh',
    overflowY: 'auto',
    outline: 'none',
  };

  const COMPLETED_BADGE = {
    position: 'absolute',
    top: -6,
    right: 8,
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
    color: '#fff',
    background: '#2e7d32',
    borderRadius: 4,
    padding: '2px 5px',
    pointerEvents: 'none',
  };

  const subtitle = { fontWeight: 400, opacity: 0.8, fontSize: 12, display: 'block', marginTop: 2 };

  const progressLabel = (ev) => {
    if (ev.totalPages === 0) return t('specialEvents.progress.comingSoon');
    if (ev.fullyCompleted) return t('specialEvents.progress.allSolved', { count: ev.totalPages });
    return t('specialEvents.progress.solved', { completed: ev.completedPages, total: ev.totalPages, count: ev.totalPages });
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={t('specialEvents.title')} {...backdrop} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3100, padding: 16 }}>
      <div style={panel}>
        <h2 style={{ margin: '0 0 14px', fontSize: 20, fontWeight: 800, textAlign: 'center', paddingRight: 36 }}>{t('specialEvents.title')}</h2>
        <ModalCloseButton onClick={() => setOpen(false)} />
        {loaded && events.length === 0 ? (
          <p style={{ textAlign: 'center', opacity: 0.7, padding: '24px 0' }}>{t('specialEvents.noEvents')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {events.map((ev) => (
              <button
                key={ev.id}
                type="button"
                style={btn}
                onClick={() => setDetail(ev.id)}
              >
                {ev.title}
                {ev.fullyCompleted && <span style={COMPLETED_BADGE}>{t('specialEvents.completed')}</span>}
                <span style={subtitle}>{progressLabel(ev)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
