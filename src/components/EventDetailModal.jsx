// components/EventDetailModal.jsx
// Page carousel for a single Special Event. Renders each page's reveal grid
// (EventDealGrid) for unlocked/completed pages, and a locked placeholder for
// pages not yet reached, browsable via arrow buttons, horizontal swipe/drag,
// or the dot indicators — all pages are always browsable, only PLAYING a
// locked page's deals is blocked.
//
// Clicking a cell SELECTS that tile (a 3px accent outline); a footer "Play"
// button is what actually starts the game. The selection is persisted in
// db/eventSelection.js so a returning player finds the same tile pre-selected
// across modal reopen and page navigation. The deal-launch logic is the same
// "discard current game?" confirmation DailyChallengeModal.jsx uses when a
// game is already in progress.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useGameStore } from '../hooks/useGameStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { fetchEventDetail, getCachedEventDetailSync, resolveInitialPageIndex, detailsDiffer } from '../repo/specialEventsRepository.js';
import { findNextUnsolvedDeal } from '../repo/specialEventsProgress.js';
import { loadEventSelectionSync, saveEventSelection, loadLastViewedPageSync, saveLastViewedPage } from '../db/eventSelection.js';
import EventDealGrid from './EventDealGrid.jsx';

const SWIPE_THRESHOLD_RATIO = 0.2; // fraction of viewport width to trigger a page change

export default function EventDetailModal() {
  const { t } = useTranslation();
  const eventId = useUiStore((s) => s.eventDetailId);
  const setEventDetailOpen = useUiStore((s) => s.setEventDetailOpen);
  const setSpecialEventsOpen = useUiStore((s) => s.setSpecialEventsOpen);
  const dealSpecialEventDeal = useGameStore((s) => s.dealSpecialEventDeal);

  const open = Boolean(eventId);
  const close = () => setEventDetailOpen(null);

  const backdrop = useModalBackdrop(close);
  useModalEscape({ open, onClose: close, id: 'event-detail', z: Z.CHILD });

  const [detail, setDetail] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [dragPx, setDragPx] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Per-page selected deal id, persisted in db/eventSelection.js. Keys are
  // stringified pageNumbers. Hydrated from the sync mirror on open so a
  // returning player sees the same selection immediately.
  const [selectedDealIdByPage, setSelectedDealIdByPage] = useState({});
  const justWonDealId = useUiStore((s) => s.winSummary?.eventDealId ?? null);

  const viewportRef = useRef(null);
  const panelRef = useRef(null);
  const dragStateRef = useRef({ startX: 0, startY: 0, width: 1, active: false });
  const justSwipedRef = useRef(false);
  const justSwipedTimerRef = useRef(null);
  // One-shot guard so the post-win auto-advance (findNextUnsolvedDeal) applies
  // exactly once per won deal. winSummary.eventDealId is never cleared (the Win
  // modal and optimistic fetch rely on it), so without this every reopen would
  // re-apply the advance and clobber a manual replay selection.
  const advancedForWonRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => panelRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => () => {
    if (justSwipedTimerRef.current) clearTimeout(justSwipedTimerRef.current);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const { eventId: eid, dealId } = e.detail || {};
      if (eid !== eventId || dealId == null) return;
      setDetail((prev) => {
        if (!prev) return prev;
        let patched = false;
        const next = {
          ...prev,
          pages: prev.pages.map((p) => ({
            ...p,
            deals: p.deals.map((d) => {
              if (d.id === dealId && !d.solved) {
                patched = true;
                return { ...d, solved: true };
              }
              return d;
            }),
          })),
        };
        if (!patched) return prev;
        let prevCompleted = true;
        for (const p of next.pages) {
          const allSolved = p.deals.length > 0 && p.deals.every((d) => d.solved);
          const completed = p.completed || allSolved;
          const unlocked = prevCompleted;
          p.completed = completed;
          p.unlocked = unlocked;
          prevCompleted = completed;
        }
        return next;
      });
    };
    window.addEventListener('event-detail-optimistic', handler);
    return () => window.removeEventListener('event-detail-optimistic', handler);
  }, [eventId]);

  useEffect(() => {
    if (!open || !eventId) return;
    const refresh = () => {
      const optimisticId = useUiStore.getState().winSummary?.eventDealId ?? null;
      fetchEventDetail(eventId, { optimisticDealIds: optimisticId != null ? [optimisticId] : [] })
        .then((fresh) => {
          if (!fresh) return;
          setDetail((prev) => (prev && !detailsDiffer(prev, fresh) ? prev : fresh));
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
  }, [open, eventId]);

  useEffect(() => {
    if (!open || !eventId) return;
    const cached = getCachedEventDetailSync(eventId);
    setSelectedDealIdByPage(loadEventSelectionSync(eventId) || {});
    if (cached) {
      const lastPage = loadLastViewedPageSync(eventId);
      const initialIdx = resolveInitialPageIndex(cached, lastPage);
      setDetail(cached);
      setIndex(initialIdx);
      setLoaded(true);
      const initialPage = cached.pages[initialIdx];
      if (initialPage) saveLastViewedPage(cached.id, initialPage.pageNumber).catch(() => {});
      setSelectedDealIdByPage((prev) => {
        const next = { ...prev };
        for (const p of cached.pages) {
          if (!p.unlocked) continue;
          const prevId = prev[String(p.pageNumber)];
          const prevStillValid = prevId != null && p.deals.some((dl) => dl.id === prevId);
          if (!prevStillValid) {
            const first = p.deals.find((dl) => !dl.solved) ?? p.deals[0];
            if (first) {
              next[String(p.pageNumber)] = first.id;
              saveEventSelection(cached.id, p.pageNumber, first.id).catch(() => {});
            }
          }
        }
        return next;
      });
      {
        const optimisticId = useUiStore.getState().winSummary?.eventDealId ?? null;
        const optimisticDealIds = optimisticId != null ? [optimisticId] : [];
        fetchEventDetail(eventId, { optimisticDealIds })
        .then((fresh) => {
          if (!fresh) return;
          const patched = fresh;
          if (!detailsDiffer(cached, patched)) return;
          setDetail(patched);
          setSelectedDealIdByPage((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const p of patched.pages) {
              if (!p.unlocked) continue;
              const prevId = prev[String(p.pageNumber)];
              const prevStillValid = prevId != null && p.deals.some((dl) => dl.id === prevId);
              if (!prevStillValid) {
                const first = p.deals.find((dl) => !dl.solved) ?? p.deals[0];
                if (first && prevId !== first.id) {
                  next[String(p.pageNumber)] = first.id;
                  changed = true;
                  saveEventSelection(patched.id, p.pageNumber, first.id).catch(() => {});
                }
              }
            }
            return changed ? next : prev;
          });
        })
        .catch(() => {});
        }
      return;
    }
    setLoaded(false);
    setDetail(null);
    {
      const optimisticId = useUiStore.getState().winSummary?.eventDealId ?? null;
      const optimisticDealIds = optimisticId != null ? [optimisticId] : [];
      fetchEventDetail(eventId, { optimisticDealIds })
      .then((d) => {
        const patched = d;
        setDetail(patched);
        if (patched && patched.pages.length > 0) {
          const lastPage = loadLastViewedPageSync(eventId);
          const initialIdx = resolveInitialPageIndex(patched, lastPage);
          setIndex(initialIdx);
          const initialPage = patched.pages[initialIdx];
          if (initialPage) saveLastViewedPage(patched.id, initialPage.pageNumber).catch(() => {});
          setSelectedDealIdByPage((prev) => {
            const next = { ...prev };
            for (const p of patched.pages) {
              if (!p.unlocked) continue;
              const prevId = prev[String(p.pageNumber)];
              const prevStillValid = prevId != null && p.deals.some((dl) => dl.id === prevId);
              if (!prevStillValid) {
                const first = p.deals.find((dl) => !dl.solved) ?? p.deals[0];
                if (first) {
                  next[String(p.pageNumber)] = first.id;
                  saveEventSelection(patched.id, p.pageNumber, first.id).catch(() => {});
                }
              }
            }
            return next;
          });
        } else {
          setIndex(0);
        }
      })
      .catch(() => setDetail(null))
      .finally(() => setLoaded(true));
    }
  }, [open, eventId]);

  useEffect(() => {
    if (!open || !detail) return;
    // Post-win auto-advance: exactly once per won deal. Solved selections are
    // legitimate replay targets, so never force-correct them — only fill pages
    // with a missing/invalid selection (e.g. a newly unlocked page).
    if (justWonDealId == null) {
      setSelectedDealIdByPage((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const p of detail.pages) {
          if (!p.unlocked) continue;
          const key = String(p.pageNumber);
          const sel = prev[key];
          const selDeal = p.deals.find((d) => d.id === sel);
          if (sel == null || !selDeal) {
            const first = p.deals.find((d) => !d.solved) ?? p.deals[0];
            if (first && next[key] !== first.id) {
              next[key] = first.id;
              changed = true;
              saveEventSelection(detail.id, p.pageNumber, first.id).catch(() => {});
            }
          }
        }
        return changed ? next : prev;
      });
      return;
    }
    const wonKey = `${detail.id}:${justWonDealId}`;
    const alreadyAdvanced = advancedForWonRef.current === wonKey;
    if (!alreadyAdvanced) advancedForWonRef.current = wonKey;
    const target = alreadyAdvanced ? null : findNextUnsolvedDeal(detail, justWonDealId);
    setSelectedDealIdByPage((prev) => {
      const next = { ...prev };
      let changed = false;
      const apply = (pageNumber, dealId, evtId) => {
        const key = String(pageNumber);
        if (next[key] !== dealId) {
          next[key] = dealId;
          changed = true;
          saveEventSelection(evtId, pageNumber, dealId).catch(() => {});
          saveLastViewedPage(evtId, pageNumber).catch(() => {});
        }
      };
      if (target) apply(target.pageNumber, target.deal.id, detail.id);
      for (const p of detail.pages) {
        if (!p.unlocked) continue;
        const key = String(p.pageNumber);
        const sel = next[key];
        const selDeal = p.deals.find((d) => d.id === sel);
        if (sel == null || !selDeal) {
          const first = p.deals.find((d) => !d.solved) ?? p.deals[0];
          if (first && next[key] !== first.id) apply(p.pageNumber, first.id, detail.id);
        }
      }
      return changed ? next : prev;
    });
  }, [open, detail, justWonDealId]);

  // Click handler for a deal cell — only selects, never starts a deal.
  // Also writes the page number so re-opening the event lands here, even
  // if the user arrived on a different page and dragged / arrowed over.
  const onSelectDeal = (deal, page) => {
    setSelectedDealIdByPage((prev) => ({ ...prev, [String(page.pageNumber)]: deal.id }));
    if (eventId) {
      saveEventSelection(eventId, page.pageNumber, deal.id).catch(() => {});
      saveLastViewedPage(eventId, page.pageNumber).catch(() => {});
    }
  };

  // Footer "Play" button handler — starts the deal for the currently-selected
  // tile of the currently-visible page. Behind the same "discard current
  // game?" confirmation DailyChallengeModal.jsx uses.
  const onPlaySelected = () => {
    if (!detail) return;
    const currentPage = pages[clampedIndex];
    if (!currentPage || !currentPage.unlocked) return;
    const dealId = selectedDealIdByPage[String(currentPage.pageNumber)];
    const deal = currentPage.deals.find((d) => d.id === dealId);
    if (!deal) return;
    const run = () => {
      dealSpecialEventDeal(deal.seed, deal.id, detail.id, detail.title);
      setEventDetailOpen(null);
      setSpecialEventsOpen(false);
    };
    if (useStatsStore.getState().isInProgress()) {
      useUiStore.getState().setPendingStartDeal(run);
      useUiStore.getState().setConfirmNewGameDialogOpen(true);
    } else {
      run();
    }
  };

  const pages = detail?.pages ?? [];
  const clampedIndex = Math.min(index, Math.max(0, pages.length - 1));

  // Persist the page the user navigates to so a re-open of the event lands
  // on the same page (the modal otherwise picks "first unlocked-but-not-yet-
  // completed" by default). Fired by arrow buttons, dot indicators, and the
  // landing heuristic via the open-time effect.
  const goTo = (i) => {
    const clamped = Math.min(Math.max(i, 0), Math.max(0, pages.length - 1));
    setIndex(clamped);
    const target = pages[clamped];
    if (target && eventId) saveLastViewedPage(eventId, target.pageNumber).catch(() => {});
  };
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
      justSwipedRef.current = true;
      if (justSwipedTimerRef.current) clearTimeout(justSwipedTimerRef.current);
      justSwipedTimerRef.current = setTimeout(() => {
        justSwipedRef.current = false;
        justSwipedTimerRef.current = null;
      }, 250);
    }
    dragStateRef.current.active = false;
    dragStateRef.current.committed = false;
    setDragging(false);
    setDragPx(0);
  };

  const handleViewportClickCapture = (e) => {
    if (justSwipedRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const trackTransform = useMemo(
    () => `translateX(calc(${-clampedIndex * 100}% + ${dragPx}px))`,
    [clampedIndex, dragPx]
  );

  if (!open) return null;

  // The currently-visible page drives the footer Play button's enabled state.
  const currentPage = pages[clampedIndex];
  const playDisabled = !currentPage || !currentPage.unlocked;
  const currentSelectedId = currentPage ? selectedDealIdByPage[String(currentPage.pageNumber)] : null;
  const canPlay = !playDisabled && currentSelectedId != null;

  const btn = {
    padding: '9px 14px',
    borderRadius: 6,
    border: '1px solid var(--ui-modal-btn-border)',
    background: 'var(--ui-modal-btn-bg)',
    color: 'var(--ui-modal-fg)',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
  };

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
                onClickCapture={handleViewportClickCapture}
                style={{ overflow: 'hidden', touchAction: 'pan-y', minHeight: 400 }}
              >
                <div style={{ display: 'flex', transform: trackTransform, transition: dragging ? 'none' : 'transform 0.3s ease' }}>
                  {pages.map((p) => (
                    <div key={p.id} style={{ flex: '0 0 100%', padding: '0 8px', boxSizing: 'border-box' }}>
                      <PageContent
                        page={p}
                        onSelectDeal={onSelectDeal}
                        selectedDealId={selectedDealIdByPage[String(p.pageNumber)] ?? null}
                      />
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

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
              <button
                type="button"
                disabled={!canPlay}
                onClick={onPlaySelected}
                style={{
                  ...btn,
                  background: 'var(--ui-modal-btn-bg-strong)',
                  opacity: canPlay ? 1 : 0.45,
                  cursor: canPlay ? 'pointer' : 'default',
                }}
              >
                {t('eventDetail.play')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PageContent({ page, onSelectDeal, selectedDealId }) {
  if (page.deals.length === 0) {
    return (
      <div style={placeholderStyle(false)}>
        <div style={{ opacity: 0.7 }}>No deals authored for this page yet.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <EventDealGrid
        page={page}
        locked={!page.unlocked}
        onSelectDeal={(deal) => onSelectDeal(deal, page)}
        selectedDealId={selectedDealId}
      />

      {page.unlocked && page.completed && (
        <button
          type="button"
          onClick={() => {}}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: '1px solid var(--ui-modal-btn-border)',
            background: 'var(--ui-modal-btn-bg)',
            color: 'var(--ui-modal-fg)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Show Postcard
        </button>
      )}
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
