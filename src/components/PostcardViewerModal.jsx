// components/PostcardViewerModal.jsx
//
// Fullscreen image viewer for a completed event page's postcard. Image only,
// centered on the display — no panel chrome.
//
// Interactions (mouse + touch unified via Pointer Events):
// - Mouse wheel zooms about the image CENTER (never cursor-pivoted, the image
//   never shifts position); click-drag pans; double-click resets to fit.
// - Touch pinch zooms; single-finger drag pans; double-tap resets.
// Dismissal: tap/click anywhere outside the image, the top-right close button
// (same shared control as every other modal), or Escape (topmost only via the
// modal stack). Dismissal flows through the shared backdrop primitive, so the
// stray synthesized click can never reach the event modal underneath.
// A Download button (lucide Download icon) sits bottom-right of the display.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import {
  POSTCARD_FIT_PADDING_PX,
  clampPan,
  fitSize,
  isDoubleTap,
  pinchDistance,
  pinchMidpoint,
  applyPinchZoom,
  applyWheelZoom,
} from '../utils/postcardTransform.js';

const DRAG_START_PX = 4;

export default function PostcardViewerModal({ imageUrl, title, fileName, onClose }) {
  const { t } = useTranslation();
  // A pinch may end with one finger lifting off the image (down+up both on
  // the backdrop), which the shared primitive would read as an outside tap.
  // Guard the backdrop close: never dismiss mid-gesture, nor within a short
  // window after a multi-touch gesture ends.
  const gestureRef = useRef({ active: 0, maxSeen: 0, multiTouchEndAt: 0 });
  const backdropClose = () => {
    const g = gestureRef.current;
    if (g.active > 0) return;
    if (Date.now() - g.multiTouchEndAt < 400) return;
    onClose();
  };
  const backdrop = useModalBackdrop(backdropClose);
  useModalEscape({ open: true, onClose, id: 'postcard-viewer', z: Z.GRANDCHILD });

  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [natural, setNatural] = useState(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 0,
    h: typeof window !== 'undefined' ? window.innerHeight : 0,
  }));
  const imgRef = useRef(null);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const downRef = useRef(null);
  const panLastRef = useRef(null);
  const movedRef = useRef(false);
  const lastTapRef = useRef(null);

  // Lock body scroll while the viewer is open; track viewport resizes so the
  // fit size and pan clamp stay correct (e.g. mobile rotation).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const fit = natural
    ? fitSize(natural.w, natural.h, viewport.w, viewport.h, POSTCARD_FIT_PADDING_PX)
    : null;

  const panTo = (tx, ty, scale) => {
    if (!fit) return { tx, ty };
    return clampPan(tx, ty, fit.width, fit.height, scale, viewport.w, viewport.h);
  };

  const resetView = () => {
    lastTapRef.current = null;
    setView({ scale: 1, tx: 0, ty: 0 });
  };

  // Non-passive wheel listener on the image itself: zoom must preventDefault
  // or the page scrolls. (Outside the image, wheel hits the backdrop and the
  // shared primitive ignores it — no accidental zoom, no scroll: body locked.)
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      setView((v) => {
        const next = applyWheelZoom(v, e.deltaY, e.deltaMode);
        const p = panTo(next.tx, next.ty, next.scale);
        return { scale: next.scale, ...p };
      });
    };
    img.addEventListener('wheel', onWheel, { passive: false });
    return () => img.removeEventListener('wheel', onWheel);
  }, [fit, viewport.w, viewport.h]);

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { e.currentTarget?.setPointerCapture(e.pointerId); } catch {}
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gestureRef.current.active += 1;
    gestureRef.current.maxSeen = Math.max(gestureRef.current.maxSeen, pointersRef.current.size);
    if (pointersRef.current.size === 1) {
      downRef.current = { x: e.clientX, y: e.clientY };
      panLastRef.current = { x: e.clientX, y: e.clientY };
      movedRef.current = false;
    } else if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { dist: pinchDistance(a, b), mid: pinchMidpoint(a, b) };
      movedRef.current = true;
      lastTapRef.current = null;
    }
  };

  const onPointerMove = (e) => {
    const prev = pointersRef.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointersRef.current.set(e.pointerId, cur);
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = pinchDistance(a, b);
      const mid = pinchMidpoint(a, b);
      const prevMid = pinchRef.current?.mid ?? mid;
      const prevDist = pinchRef.current?.dist ?? dist;
      setView((v) => {
        const zoomed = applyPinchZoom(v, prevDist, dist);
        const p = panTo(v.tx + (mid.x - prevMid.x), v.ty + (mid.y - prevMid.y), zoomed.scale);
        return { scale: zoomed.scale, ...p };
      });
      pinchRef.current = { dist, mid };
      return;
    }
    if (!downRef.current) return;
    const dx = cur.x - downRef.current.x;
    const dy = cur.y - downRef.current.y;
    if (dx * dx + dy * dy > DRAG_START_PX * DRAG_START_PX) movedRef.current = true;
    if (!movedRef.current) return;
    const last = panLastRef.current ?? downRef.current;
    panLastRef.current = cur;
    const stepX = cur.x - last.x;
    const stepY = cur.y - last.y;
    setView((v) => {
      const p = panTo(v.tx + stepX, v.ty + stepY, v.scale);
      return { ...v, ...p };
    });
  };

  const endPointer = (e) => {
    const wasSingle = pointersRef.current.size === 1 && pointersRef.current.has(e.pointerId);
    pointersRef.current.delete(e.pointerId);
    gestureRef.current.active = Math.max(0, gestureRef.current.active - 1);
    if (pointersRef.current.size === 0) {
      if (gestureRef.current.maxSeen >= 2) gestureRef.current.multiTouchEndAt = Date.now();
      gestureRef.current.maxSeen = 0;
    }
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (!wasSingle) {
      if (pointersRef.current.size === 0) downRef.current = null;
      return;
    }
    const up = { x: e.clientX, y: e.clientY };
    const down = downRef.current;
    downRef.current = null;
    if (movedRef.current || !down) {
      movedRef.current = false;
      return;
    }
    const distSq = (up.x - down.x) * (up.x - down.x) + (up.y - down.y) * (up.y - down.y);
    if (distSq > DRAG_START_PX * DRAG_START_PX) return;
    // A clean tap: double-tap resets, otherwise remember it for the next tap.
    const tap = { t: Date.now(), x: up.x, y: up.y };
    if (isDoubleTap(lastTapRef.current, tap)) {
      resetView();
    } else {
      lastTapRef.current = tap;
    }
  };

  // The gesture layer is layout-only (pointer-events:none): taps outside the
  // image hit the backdrop container itself, which is what the shared backdrop
  // primitive requires for outside-tap dismissal (down+up both on the
  // backdrop). The image is the sole gesture surface, so drags starting on it
  // keep pointer capture and can never dismiss, even released off-image.

  const onDownload = async () => {
    const name = fileName || 'postcard.jpg';
    try {
      let href = imageUrl;
      let revoke = null;
      if (!imageUrl.startsWith('blob:')) {
        const res = await fetch(imageUrl, { mode: 'cors' });
        if (!res.ok) throw new Error('download fetch failed');
        href = URL.createObjectURL(await res.blob());
        revoke = href;
      }
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 4000);
    } catch {
      try { window.open(imageUrl, '_blank', 'noopener'); } catch {}
    }
  };

  const chromeBtn = {
    width: 34,
    height: 34,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    border: '1px solid var(--ui-modal-btn-border)',
    background: 'var(--ui-modal-btn-bg)',
    color: 'var(--ui-modal-fg)',
    cursor: 'pointer',
    padding: 0,
    zIndex: 2,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('eventDetail.postcardViewerLabel', { title })}
      {...backdrop}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: Z.GRANDCHILD,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <ModalCloseButton onClick={onClose} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        {/* Always mounted: `natural` (and therefore `fit`) is bootstrapped by
            this image's own onLoad, so gating on `fit` would deadlock and show
            nothing. Pre-load it stays hidden with CSS contain fallbacks, then
            swaps to the explicit fit size — visually identical, no snap. */}
        <img
          ref={imgRef}
          src={imageUrl}
          alt={title}
          draggable={false}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onLoad={(e) => {
            const el = e.currentTarget;
            if (el.naturalWidth > 0 && el.naturalHeight > 0) {
              setNatural({ w: el.naturalWidth, h: el.naturalHeight });
            }
          }}
          style={{
            ...(fit
              ? {
                  width: fit.width,
                  height: fit.height,
                  maxWidth: 'none',
                  maxHeight: 'none',
                  visibility: 'visible',
                  transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
                  transformOrigin: 'center',
                }
              : {
                  width: 'auto',
                  height: 'auto',
                  maxWidth: 'calc(100vw - 32px)',
                  maxHeight: 'calc(100vh - 32px)',
                  visibility: 'hidden',
                }),
            userSelect: 'none',
            WebkitUserSelect: 'none',
            pointerEvents: 'auto',
            touchAction: 'none',
            cursor: view.scale > 1 ? 'grab' : 'default',
          }}
        />
      </div>
      <button
        type="button"
        onClick={onDownload}
        aria-label={t('eventDetail.downloadPostcard')}
        title={t('eventDetail.downloadPostcard')}
        style={{ ...chromeBtn, position: 'absolute', right: 10, bottom: 10 }}
      >
        <Download size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
