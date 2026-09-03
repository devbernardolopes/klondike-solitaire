// components/EventDetailModal.jsx
// Page carousel for a single Special Event. Renders each page's reveal grid
// (EventDealGrid) for unlocked/completed pages, and a locked placeholder for
// pages not yet reached, browsable via arrow buttons, horizontal swipe/drag,
// or the dot indicators — all pages are always browsable, only PLAYING a
// locked page's deals is blocked.
//
// Clicking an unsolved cell deals that exact seed via
// useGameStore's dealSpecialEventDeal, behind the same "discard current
// game?" confirmation DailyChallengeModal.jsx uses when a game is already in
// progress, then closes both this modal and the events list to reveal the
// board.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useGameStore } from '../hooks/useGameStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { fetchEventDetail } from '../repo/specialEventsRepository.js';
import EventDealGrid from './EventDealGrid.jsx';

const SWIPE_THRESHOLD_RATIO = 0.2; // fraction of viewport width to trigger a page change

export default function EventDetailModal() {
  const eventId = useUiStore((s) => s.eventDetailId);
  const setEventDetailOpen = useUiStore((s) => s.setEventDetailOpen);
  const setSpecialEventsOpen = useUiStore((s) => s.setSpecialEventsOpen);
  const dealSpecialEventDeal = useGameStore((s) => s.dealSpecialEventDeal);

  const open = Boolean(eventId);
  const close = () => setEventDetailOpen(null);
  const backToList = () => {
    setEventDetailOpen(null);
    setSpecialEventsOpen(true);
  };

  const backdrop = useModalBackdrop(close);
  useModalEscape({ open, onClose: close, id: 'event-detail', z: Z.CHILD });

  const onPlayDeal = (deal) => {
    const run = () => {
      // Cache the event id + title on the UI store so WinModal can render a
      // banner with the event's name and a "Return to Special Event" button
      // without a second fetch. The detail object is loaded by the useEffect
      // above; null-check defensively in case the user clicks before fetch
      // resolves (rare; the modal is loading-shielded but the click lands
      // synchronously).
      if (detail) {
        useUiStore.getState().setCurrentEventMeta(detail.id, detail.title);
      }
      dealSpecialEventDeal(deal.seed, deal.id);
      setEventDetailOpen(null);
      setSpecialEventsOpen(false);
    };
    // Same "discard current game?" guard DailyChallengeModal.jsx uses when a
    // game is already in progress (records a loss on confirm).
    if (useStatsStore.getState().isInProgress()) {
      useUiStore.getState().setPendingStartDeal(run);
      useUiStore.getState().setConfirmNewGameDialogOpen(true);
    } else {
      run();
    }
  };

  const [detail, setDetail] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [dragPx, setDragPx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const viewportRef = useRef(null);
  const panelRef = useRef(null);
  const dragStateRef = useRef({ startX: 0, startY: 0, width: 1, active: false });

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => panelRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setDetail(null);
    fetchEventDetail(eventId)
      .then((d) => {
        setDetail(d);
        if (d && d.pages.length > 0) {
          // Land on the first unlocked-but-not-yet-completed page, so a
          // returning player sees where to continue. Fall back to the last
          // page if everything's done, or page 0 if nothing's unlocked yet.
          const target = d.pages.findIndex((p) => p.unlocked && !p.completed);
          setIndex(target >= 0 ? target : d.pages.length - 1);
        } else {
          setIndex(0);
        }
      })
      .catch(() => setDetail(null))
      .finally(() => setLoaded(true));
  }, [open, eventId]);

  const pages = detail?.pages ?? [];
  const clampedIndex = Math.min(index, Math.max(0, pages.length - 1));

  const goTo = (i) => setIndex(Math.min(Math.max(i, 0), Math.max(0, pages.length - 1)));
  const goPrev = () => goTo(clampedIndex - 1);
  const goNext = () => goTo(clampedIndex + 1);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowLeft') goPrev();
    else if (e.key === 'ArrowRight') goNext();
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      width: viewportRef.current?.clientWidth || 1,
      active: true,
      pointerId: e.pointerId,
      committed: false,
    };
  };

  const onPointerMove = (e) => {
    if (!dragStateRef.current.active) return;
    const dx = e.clientX - dragStateRef.current.startX;
    const dy = e.clientY - dragStateRef.current.startY;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) return; // vertical gesture, ignore
    if (!dragStateRef.current.committed && Math.abs(dx) > 10) {
      e.currentTarget.setPointerCapture(dragStateRef.current.pointerId);
      dragStateRef.current.committed = true;
      setDragging(true);
    }
    if (dragStateRef.current.committed) {
      setDragPx(dx);
    }
  };

  const endDrag = (e) => {
    if (!dragStateRef.current.active) return;
    const { width, committed, pointerId } = dragStateRef.current;
    if (committed && e && e.currentTarget && typeof e.currentTarget.hasPointerCapture === 'function' && e.currentTarget.hasPointerCapture(pointerId)) {
      e.currentTarget.releasePointerCapture(pointerId);
    }
    if (committed) {
      const threshold = width * SWIPE_THRESHOLD_RATIO;
      if (dragPx <= -threshold) goNext();
      else if (dragPx >= threshold) goPrev();
    }
    dragStateRef.current.active = false;
    dragStateRef.current.committed = false;
    setDragging(false);
    setDragPx(0);
  };

  const trackTransform = useMemo(
    () => `translateX(calc(${-clampedIndex * 100}% + ${dragPx}px))`,
    [clampedIndex, dragPx]
  );

  if (!open) return null;

  const panel = {
    position: 'relative',
    background: 'var(--ui-modal-panel-bg)',
    color: 'var(--ui-modal-panel-fg)',
    border: 'var(--ui-modal-panel-border)',
    borderRadius: 'var(--ui-modal-panel-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(94vw, 520px)',
    maxWidth: '100%',
    maxHeight: '85vh',
    overflowY: 'auto',
    outline: 'none',
  };

  const arrowBtn = (disabled) => ({
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    width: 34,
    height: 34,
    borderRadius: '50%',
    border: '1px solid var(--ui-modal-btn-border)',
    background: 'var(--ui-modal-btn-bg)',
    color: 'var(--ui-modal-fg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.25 : 1,
    pointerEvents: disabled ? 'none' : 'auto',
    zIndex: 2,
  });

  return (
    <div role="dialog" aria-modal="true" aria-label={detail?.title || 'Event'} {...backdrop} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3100, padding: 16 }}>
      <div ref={panelRef} tabIndex={-1} onKeyDown={onKeyDown} style={panel}>
        <button type="button" onClick={backToList} style={{ position: 'absolute', top: 20, left: 22, background: 'none', border: 'none', color: 'var(--ui-modal-fg)', opacity: 0.7, cursor: 'pointer', fontSize: 13, padding: 0 }}>← Events</button>
        <ModalCloseButton onClick={close} />
        <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, textAlign: 'center', paddingTop: 2 }}>{detail?.title || (loaded ? 'Event' : '')}</h2>
        {detail?.description && (
          <p style={{ margin: '0 0 14px', textAlign: 'center', fontSize: 13, opacity: 0.75 }}>{detail.description}</p>
        )}

        {loaded && pages.length === 0 && (
          <p style={{ textAlign: 'center', opacity: 0.7, padding: '24px 0' }}>This event doesn't have any pages yet.</p>
        )}

        {pages.length > 0 && (
          <>
            <div style={{ position: 'relative', marginTop: 8 }}>
              {pages.length > 1 && clampedIndex > 0 && (
                <button type="button" aria-label="Previous page" onClick={goPrev} style={{ ...arrowBtn(false), left: -6 }}>
                  <ChevronLeft size={20} />
                </button>
              )}
              {pages.length > 1 && clampedIndex < pages.length - 1 && (
                <button type="button" aria-label="Next page" onClick={goNext} style={{ ...arrowBtn(false), right: -6 }}>
                  <ChevronRight size={20} />
                </button>
              )}

              <div
                ref={viewportRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ overflow: 'hidden', touchAction: 'pan-y', minHeight: 400 }}
              >
                <div style={{ display: 'flex', transform: trackTransform, transition: dragging ? 'none' : 'transform 0.3s ease' }}>
                  {pages.map((p) => (
                    <div key={p.id} style={{ flex: '0 0 100%', padding: '0 8px', boxSizing: 'border-box' }}>
                      <PageContent page={p} onPlayDeal={onPlayDeal} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {pages.length > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 7, marginTop: 14 }}>
                {pages.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-label={`Page ${p.pageNumber}`}
                    aria-current={i === clampedIndex}
                    onClick={() => goTo(i)}
                    style={{
                      width: 9,
                      height: 9,
                      padding: 0,
                      border: i === clampedIndex ? '1px solid var(--ui-modal-fg)' : 'none',
                      borderRadius: '50%',
                      cursor: 'pointer',
                      background: p.completed ? '#2e7d32' : p.unlocked ? 'var(--ui-modal-fg)' : 'rgba(128,128,128,0.5)',
                      opacity: i === clampedIndex ? 1 : 0.55,
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PageContent({ page, onPlayDeal }) {
  if (!page.unlocked) {
    return (
      <div style={placeholderStyle(true)}>
        <Lock size={28} style={{ opacity: 0.5 }} />
        <div style={{ fontWeight: 700, marginTop: 10 }}>Page {page.pageNumber} locked</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Complete the previous page to unlock</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      {page.deals.length === 0 ? (
        <div style={placeholderStyle(false)}>
          <div style={{ opacity: 0.7 }}>No deals authored for this page yet.</div>
        </div>
      ) : (
        <EventDealGrid page={page} onPlayDeal={onPlayDeal} />
      )}

      <div style={{ fontSize: 12, fontWeight: 700, color: page.completed ? '#2e7d32' : undefined, opacity: page.completed ? 1 : 0.75 }}>
        {page.completed ? 'Completed' : page.coinReward > 0 ? `+${page.coinReward} coins on completion` : 'In progress'}
      </div>
    </div>
  );
}

function placeholderStyle(dimmed) {
  return {
    minHeight: 220,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    borderRadius: 10,
    border: '1px dashed var(--ui-modal-btn-border)',
    background: 'var(--ui-modal-btn-bg)',
    opacity: dimmed ? 0.55 : 1,
    userSelect: 'none',
  };
}
