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

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalBackdrop } from './modalBackdrop.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { OVERHANG_BADGE_CLEARANCE, OVERHANG_BADGE_LIFT, OVERHANG_BADGE_RIGHT } from './modalBadge.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { fetchSpecialEvents, getCachedEventsSummarySync } from '../repo/specialEventsRepository.js';
import { translateSpecialEvent } from '../i18n/db.js';

export default function SpecialEventsModal() {
  const { t, i18n } = useTranslation();
  const open = useUiStore((s) => s.specialEventsOpen);
  const setOpen = useUiStore((s) => s.setSpecialEventsOpen);
  const setDetail = useUiStore((s) => s.setEventDetailOpen);
  const eventDetailId = useUiStore((s) => s.eventDetailId);

  const backdrop = useModalBackdrop(() => setOpen(false));
  useModalEscape({ open, onClose: () => setOpen(false), id: 'events', z: Z.CHILD });

  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const [scrollMetrics, setScrollMetrics] = useState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });

  useEffect(() => {
    if (!open || eventDetailId != null) return;
    const refresh = () => {
      fetchSpecialEvents()
        .then((fresh) => {
          setEvents((prev) => {
            const freshIds = fresh.map((e) => e.id).join('|');
            const prevIds = prev.map((e) => e.id).join('|');
            const differ = freshIds !== prevIds || fresh.some((f, i) => {
              const c = prev[i];
              return !c || f.totalPages !== c.totalPages || f.completedPages !== c.completedPages || f.fullyCompleted !== c.fullyCompleted || f.totalDeals !== c.totalDeals || f.solvedDeals !== c.solvedDeals || f.startsAt !== c.startsAt;
            });
            return differ ? fresh.map(translateSpecialEvent) : prev;
          });
        })
        .catch(() => {});
    };
    const onFlushed = () => refresh();
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener('sync-flushed', onFlushed);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('sync-flushed', onFlushed);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [open, eventDetailId]);

  useEffect(() => {
    if (!open) return;
    if (eventDetailId != null) return;
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
            return !c || f.totalPages !== c.totalPages || f.completedPages !== c.completedPages || f.fullyCompleted !== c.fullyCompleted || f.totalDeals !== c.totalDeals || f.solvedDeals !== c.solvedDeals || f.startsAt !== c.startsAt;
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
  }, [open, eventDetailId]);

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
    if (contentRef.current) observer?.observe(contentRef.current);
    return () => {
      element.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [open]);

  if (!open) return null;

  const showScrollUp = scrollMetrics.scrollTop > 0;
  const showScrollDown = scrollMetrics.scrollTop + scrollMetrics.clientHeight < scrollMetrics.scrollHeight - 1;
  const scrollButton = { position: 'absolute', left: '50%', transform: 'translateX(-50%)', width: 34, height: 28, display: 'grid', placeItems: 'center', padding: 0, border: '1px solid var(--ui-modal-panel-border)', borderRadius: 999, background: 'color-mix(in srgb, var(--ui-modal-panel-bg) 82%, transparent)', color: 'var(--ui-modal-panel-fg)', boxShadow: '0 2px 8px rgba(0,0,0,0.22)', backdropFilter: 'blur(4px)', cursor: 'pointer', zIndex: 1 };

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
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    outline: 'none',
  };

  const COMPLETED_BADGE = {
    position: 'absolute',
    top: -OVERHANG_BADGE_LIFT,
    right: OVERHANG_BADGE_RIGHT,
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
    color: '#fff',
    background: '#2e7d32',
    borderRadius: 4,
    padding: '2px 5px',
    pointerEvents: 'none',
  };

  // Same overhang geometry as COMPLETED_BADGE (so the scrollport's top
  // clearance covers it), but theme-aware and visually distinct from green.
  const PROGRESS_BADGE = {
    position: 'absolute',
    top: -OVERHANG_BADGE_LIFT,
    right: OVERHANG_BADGE_RIGHT,
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
    color: 'var(--ui-badge-progress-fg, #fff)',
    background: 'var(--ui-badge-progress-bg, #1d6fe0)',
    borderRadius: 4,
    padding: '2px 5px',
    pointerEvents: 'none',
  };

  const subtitle = { fontWeight: 400, opacity: 0.8, fontSize: 12, display: 'block', marginTop: 2 };

  // Unambiguous calendar date for the availability subtitle: day-first with
  // the month spelled out ("2 February 2026"), in the player's language, so
  // day/month can never be confused as in numeric formats like 2026-02-02.
  const formatEventDate = (iso) => {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      return d.toLocaleDateString(i18n.language || 'en', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return null;
    }
  };

  // Whole-percent share of solved deals (null when the total is unknown).
  // Shown as a badge; hidden at 0% and at 100% (Completed takes its place).
  const progressPercent = (ev) => {
    const total = ev.totalDeals ?? 0;
    if (total <= 0) return null;
    return Math.round(((ev.solvedDeals ?? 0) / total) * 100);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={t('specialEvents.title')} {...backdrop} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3100, padding: 16 }}>
      <div style={panel}>
        <h2 style={{ margin: '0 0 14px', fontSize: 20, fontWeight: 800, textAlign: 'center', paddingRight: 36 }}>{t('specialEvents.title')}</h2>
        <ModalCloseButton onClick={() => setOpen(false)} />
        <div style={{ position: 'relative', flex: '0 1 auto', minHeight: 0, overflow: 'hidden' }}>
        <div ref={scrollRef} className="modal-body-scroll" style={{ height: 'auto', maxHeight: 'calc(85vh - 74px)', overflowY: 'auto', paddingTop: OVERHANG_BADGE_LIFT + OVERHANG_BADGE_CLEARANCE, paddingBottom: 12, boxSizing: 'border-box' }}>
        <div ref={contentRef}>
        {loaded && events.length === 0 ? (
          <p style={{ textAlign: 'center', opacity: 0.7, padding: '24px 0' }}>{t('specialEvents.noEvents')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {events.map((ev) => {
              const pct = progressPercent(ev);
              const done = ev.fullyCompleted || pct === 100;
              const showProgress = !done && pct != null && pct > 0;
              const availableDate = ev.totalPages === 0 ? formatEventDate(ev.startsAt) : null;
              return (
                <button
                  key={ev.id}
                  type="button"
                  style={btn}
                  onClick={() => setDetail(ev.id)}
                >
                  {ev.title}
                  {done
                    ? <span style={COMPLETED_BADGE}>{t('specialEvents.completed')}</span>
                    : showProgress && <span style={PROGRESS_BADGE} aria-label={t('specialEvents.progress.percentAria', { percent: pct })}>{`${pct}%`}</span>}
                  {ev.totalPages === 0 && (
                    <span style={subtitle}>
                      {availableDate
                        ? t('specialEvents.availableFrom', { date: availableDate })
                        : t('specialEvents.progress.comingSoon')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        </div>
        </div>
        {showScrollUp && <button type="button" aria-label={t('specialEvents.scrollTop')} onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} style={{ ...scrollButton, top: 8 }}><ChevronUp size={18} strokeWidth={2.5} aria-hidden="true" /></button>}
        {showScrollDown && <button type="button" aria-label={t('specialEvents.scrollBottom')} onClick={() => { const element = scrollRef.current; element?.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }); }} style={{ ...scrollButton, bottom: 8 }}><ChevronDown size={18} strokeWidth={2.5} aria-hidden="true" /></button>}
        </div>
      </div>
    </div>
  );
}
