// components/AwardsModal.jsx
//
// "Awards" showcase: unlocked achievements + unlocked event postcards on
// theme-aware shelves. Data comes from repo/awardsRepository.js (unlock-
// ordered across both kinds); this modal only pages, renders, and navigates.
//
// Layout: fixed-height panel (85vh, like AchievementsModal) with an
// overflow-hidden body. Shelf capacity is measured (ResizeObserver): each
// page holds shelvesPerPage × perShelf tiles, so taller viewports fit more
// shelves and there is never a vertical scroll. With nothing unlocked, one
// empty page of empty shelves renders.
//
// Navigation mirrors EventDetailModal.jsx: arrow buttons, dot indicators,
// pointer drag/swipe, vertical mouse wheel, and keyboard arrows. Tiles open
// the existing detail surfaces (AchievementDetailModal /
// PostcardViewerModal) stacked above at Z.GRANDCHILD.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import AchievementImage from './AchievementImage.jsx';
import AchievementDetailModal from './AchievementDetailModal.jsx';
import PostcardViewerModal from './PostcardViewerModal.jsx';
import { eventImageUrl, onEventImageError } from '../utils/eventImage.js';
import { translateAchievement } from '../i18n/db.js';
import { fetchAwardItems, paginateAwards } from '../repo/awardsRepository.js';

const TILE = 64;
const TILE_GAP = 12;
const SHELF_ROW_H = 96;
const SLIDE_MS = 300;
const WHEEL_COOLDOWN_MS = 350;
// Swipe commits past 20% of the viewport width (EventDetailModal parity).
const SWIPE_COMMIT_FRACTION = 0.2;

function chunk(row, size) {
  const out = [];
  for (let i = 0; i < row.length; i += size) out.push(row.slice(i, i + size));
  return out;
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function AwardsModal({ open, onClose }) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const bodyRef = useRef(null);
  const viewportRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);
  useModalEscape({ open, onClose, id: 'awards', z: Z.CHILD });

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [capacity, setCapacity] = useState({ perShelf: 4, shelves: 3 });
  const [dragPx, setDragPx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [suppressTrackAnim, setSuppressTrackAnim] = useState(true);
  const [selectedAchievement, setSelectedAchievement] = useState(null);
  const [postcard, setPostcard] = useState(null);

  const genRef = useRef(0);
  const dragStateRef = useRef({ startX: 0, width: 1, active: false, committed: false, pointerId: null });
  const justSwipedTimerRef = useRef(null);
  const suppressTimerRef = useRef(null);
  const wheelLockRef = useRef(0);
  // Latest page-step callbacks for the wheel listener (attached once per
  // open, so it reads through this ref instead of stale closures).
  const navRef = useRef({ prev: () => {}, next: () => {} });

  // Load unlocked awards on open. Generation-guarded: a slow fetch from a
  // previous open never clobbers the current one.
  useEffect(() => {
    if (!open) return undefined;
    const gen = ++genRef.current;
    setLoading(true);
    setIndex(0);
    fetchAwardItems()
      .then((rows) => {
        if (gen !== genRef.current) return;
        setItems(rows);
        setLoading(false);
      })
      .catch(() => {
        if (gen !== genRef.current) return;
        setItems([]);
        setLoading(false);
      });
    return undefined;
  }, [open]);

  // While-open live refresh (mirrors the events modals): own-device queue
  // flushes and tab refocus converge newly unlocked awards without polling.
  useEffect(() => {
    if (!open) return undefined;
    const gen = () => genRef.current;
    const refresh = () => {
      const g = ++genRef.current;
      fetchAwardItems()
        .then((rows) => {
          if (g !== gen()) return;
          setItems(rows);
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
  }, [open]);

  // Measure the shelf body: capacity follows the fixed panel height, so
  // taller viewports fit more shelves and nothing ever scrolls.
  useEffect(() => {
    if (!open) return undefined;
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const w = el.clientWidth || 0;
      const h = el.clientHeight || 0;
      if (w <= 0 || h <= 0) return;
      setCapacity({
        perShelf: Math.max(1, Math.floor((w + TILE_GAP) / (TILE + TILE_GAP))),
        shelves: Math.max(1, Math.floor(h / SHELF_ROW_H)),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  // Focus the panel on open for keyboard navigation.
  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => dialogRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  // Clear transient timers on unmount.
  useEffect(() => () => {
    if (justSwipedTimerRef.current) clearTimeout(justSwipedTimerRef.current);
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
  }, []);

  const perPage = Math.max(1, capacity.perShelf * capacity.shelves);
  const pages = useMemo(() => paginateAwards(items, perPage), [items, perPage]);
  const clampedIndex = Math.min(index, pages.length - 1);

  // Clamp the page when a resize shrinks capacity below the current index.
  useEffect(() => {
    if (index > pages.length - 1) setIndex(pages.length - 1);
  }, [index, pages.length]);

  // Vertical mouse wheel turns pages (down → next, up → prev). MUST stay
  // above the open-gate early return below (Rules of Hooks). Native
  // non-passive listener — React's onWheel can't preventDefault. The
  // cooldown covers the slide so one notch moves exactly one page; a wheel
  // during an active drag is ignored.
  useEffect(() => {
    if (!open) return undefined;
    const el = viewportRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (pages.length < 2) return;
      if (dragStateRef.current.active) return;
      const dy = e.deltaY;
      if (!dy || Number.isNaN(dy)) return;
      const now = Date.now();
      if (now - wheelLockRef.current < WHEEL_COOLDOWN_MS) return;
      e.preventDefault();
      wheelLockRef.current = now;
      if (dy > 0) navRef.current.next();
      else navRef.current.prev();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open, pages.length]);

  if (!open) return null;

  const goTo = (idx) => {
    const next = Math.max(0, Math.min(pages.length - 1, idx));
    setSuppressTrackAnim(false);
    setIndex(next);
  };
  const goPrev = () => goTo(clampedIndex - 1);
  const goNext = () => goTo(clampedIndex + 1);
  navRef.current = { prev: goPrev, next: goNext };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowLeft') goPrev();
    else if (e.key === 'ArrowRight') goNext();
  };

  // Pointer drag/swipe (mouse + touch unified, EventDetailModal parity).
  const onViewportPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pages.length < 2) return;
    dragStateRef.current = {
      startX: e.clientX,
      width: viewportRef.current?.clientWidth || 1,
      active: true,
      committed: false,
      pointerId: e.pointerId,
    };
  };
  const onViewportPointerMove = (e) => {
    const st = dragStateRef.current;
    if (!st.active || (st.pointerId != null && e.pointerId !== st.pointerId)) return;
    const dx = e.clientX - st.startX;
    if (!st.committed && Math.abs(dx) > 4) {
      st.committed = true;
      setDragging(true);
    }
    if (st.committed) setDragPx(dx);
  };
  const endViewportDrag = (e) => {
    const st = dragStateRef.current;
    if (!st.active || (e && st.pointerId != null && e.pointerId !== st.pointerId)) return;
    const dx = e ? e.clientX - st.startX : 0;
    dragStateRef.current = { startX: 0, width: 1, active: false, committed: false, pointerId: null };
    if (!st.committed) {
      setDragging(false);
      setDragPx(0);
      return;
    }
    const threshold = st.width * SWIPE_COMMIT_FRACTION;
    setDragging(false);
    setDragPx(0);
    if (dx <= -threshold) goTo(clampedIndex + 1);
    else if (dx >= threshold) goTo(clampedIndex - 1);
    // Swallow the click a drag-end synthesizes so a tile doesn't open.
    if (justSwipedTimerRef.current) clearTimeout(justSwipedTimerRef.current);
    justSwipedTimerRef.current = setTimeout(() => { justSwipedTimerRef.current = null; }, 120);
  };

  const openTile = (item) => {
    if (justSwipedTimerRef.current) return;
    if (item.kind === 'achievement') {
      const translated = translateAchievement({
        id: item.ref?.id ?? item.id,
        name: item.ref?.name ?? item.title,
        description: item.ref?.description ?? '',
      });
      setSelectedAchievement({ ...translated, image_path: item.imagePath, earnedAt: item.unlockedAt });
    } else {
      const page = item.ref?.page ?? {};
      const base = String(page.imagePath || item.imagePath || '').split('/').pop() || '';
      const ext = /\.([a-z0-9]+)$/i.test(base) ? base.slice(base.lastIndexOf('.')) : '.jpg';
      setPostcard({
        imageUrl: eventImageUrl(page.imagePath ?? item.imagePath),
        title: item.title,
        fileName: `awards-page-${page.pageNumber ?? ''}${ext.toLowerCase()}`,
      });
    }
  };

  const tileLabel = (item) => {
    if (item.kind === 'achievement') {
      try {
        return translateAchievement({
          id: item.ref?.id ?? item.id,
          name: item.ref?.name ?? item.title,
          description: item.ref?.description ?? '',
        }).name;
      } catch {
        return item.title;
      }
    }
    return t('awards.postcardLabel', { title: item.title, page: item.ref?.pageNumber ?? '' });
  };

  const renderTile = (item) => {
    const label = tileLabel(item);
    const inner = item.kind === 'achievement'
      ? (
        <AchievementImage
          achievement={{ image_path: item.imagePath }}
          alt=""
          style={{ width: TILE, height: TILE, objectFit: 'cover', display: 'block' }}
        />
      )
      : (
        <img
          src={eventImageUrl(item.imagePath)}
          alt=""
          onError={onEventImageError}
          style={{ width: TILE, height: TILE, objectFit: 'cover', display: 'block' }}
          draggable={false}
        />
      );
    return (
      <button
        key={item.id}
        type="button"
        aria-label={label}
        title={label}
        onClick={() => openTile(item)}
        style={{
          width: TILE,
          height: TILE,
          padding: 0,
          borderRadius: 8,
          overflow: 'hidden',
          flex: '0 0 auto',
          border: '1px solid var(--ui-modal-panel-border)',
          background: 'var(--ui-modal-panel-bg)',
          boxShadow: '0 3px 8px rgba(0,0,0,0.35)',
          cursor: 'pointer',
        }}
      >
        {inner}
      </button>
    );
  };

  // One shelf row: its tiles over a full-width plank. The plank spans the
  // row even when partially filled; empty rows render bare planks.
  const renderShelf = (tiles, key) => (
    <div key={key} style={{ height: SHELF_ROW_H, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ display: 'flex', gap: TILE_GAP, alignItems: 'flex-end', padding: '0 4px', minHeight: TILE }}>
        {tiles.map(renderTile)}
      </div>
      <div
        aria-hidden="true"
        style={{
          height: 10,
          marginTop: 6,
          borderRadius: 3,
          borderTop: '1px solid var(--ui-modal-panel-border)',
          background: 'linear-gradient(to bottom, color-mix(in srgb, var(--ui-modal-panel-fg) 26%, transparent), color-mix(in srgb, var(--ui-modal-panel-fg) 8%, transparent))',
          boxShadow: '0 6px 10px -4px rgba(0,0,0,0.45)',
        }}
      />
    </div>
  );

  const renderPage = (pageItems, pageIdx) => {
    const rows = chunk(pageItems, capacity.perShelf);
    while (rows.length < capacity.shelves) rows.push([]);
    return (
      <div key={pageIdx} style={{ flex: '0 0 100%', minWidth: 0, overflow: 'hidden' }}>
        {rows.slice(0, capacity.shelves).map((tiles, r) => renderShelf(tiles, r))}
      </div>
    );
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
    height: '85vh',
    display: 'flex',
    flexDirection: 'column',
  };
  const arrowBtn = {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    width: 34,
    height: 44,
    display: 'grid',
    placeItems: 'center',
    padding: 0,
    border: '1px solid var(--ui-modal-panel-border)',
    borderRadius: 999,
    background: 'color-mix(in srgb, var(--ui-modal-panel-bg) 82%, transparent)',
    color: 'var(--ui-modal-panel-fg)',
    cursor: 'pointer',
    zIndex: 1,
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('awards.title')}
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={onKeyDown}
        {...backdrop}
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
        <div style={panel}>
          <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>{t('awards.title')}</h2>
          <ModalCloseButton onClick={onClose} />
          {!loading && items.length === 0 && (
            <div style={{ fontSize: 13, opacity: 0.75, margin: '0 0 8px' }}>{t('awards.empty')}</div>
          )}

          <div ref={bodyRef} style={{ position: 'relative', flex: 1, minHeight: 0, marginTop: 8 }}>
            <div
              ref={viewportRef}
              onPointerDown={onViewportPointerDown}
              onPointerMove={onViewportPointerMove}
              onPointerUp={endViewportDrag}
              onPointerCancel={endViewportDrag}
              style={{ overflow: 'hidden', touchAction: 'pan-y', height: '100%' }}
            >
              <div
                style={{
                  display: 'flex',
                  height: '100%',
                  transform: `translateX(calc(${-clampedIndex * 100}% + ${dragPx}px))`,
                  transition: suppressTrackAnim || dragging ? 'none' : `transform ${SLIDE_MS}ms ease`,
                }}
              >
                {pages.map(renderPage)}
              </div>
            </div>
            {pages.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label={t('awards.prevPage')}
                  onClick={goPrev}
                  disabled={clampedIndex === 0}
                  style={{ ...arrowBtn, left: -6, opacity: clampedIndex === 0 ? 0.35 : 1 }}
                >
                  <ChevronLeft size={20} strokeWidth={2.5} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={t('awards.nextPage')}
                  onClick={goNext}
                  disabled={clampedIndex === pages.length - 1}
                  style={{ ...arrowBtn, right: -6, opacity: clampedIndex === pages.length - 1 ? 0.35 : 1 }}
                >
                  <ChevronRight size={20} strokeWidth={2.5} aria-hidden="true" />
                </button>
              </>
            )}
          </div>

          {pages.length > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 7, marginTop: 10 }} role="tablist" aria-label={t('awards.pageAria', { current: clampedIndex + 1, total: pages.length })}>
              {pages.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === clampedIndex}
                  aria-label={t('awards.pageAria', { current: i + 1, total: pages.length })}
                  onClick={() => goTo(i)}
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    border: '1px solid var(--ui-modal-panel-border)',
                    background: i === clampedIndex ? 'var(--ui-modal-panel-fg)' : 'transparent',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <AchievementDetailModal
        achievement={selectedAchievement}
        open={Boolean(selectedAchievement)}
        onClose={() => setSelectedAchievement(null)}
      />
      {postcard && (
        <PostcardViewerModal
          imageUrl={postcard.imageUrl}
          title={postcard.title}
          fileName={postcard.fileName}
          onClose={() => setPostcard(null)}
        />
      )}
    </>
  );
}
