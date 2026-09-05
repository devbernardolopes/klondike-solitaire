// utils/postcardTransform.js
//
// Pure transform math for the postcard image viewer (DOM/React-free, so it is
// unit-testable in isolation). The viewer renders `translate(tx,ty) scale(s)`
// with `transform-origin: center`, which is what makes wheel zoom positional:
// scaling about the center keeps the image fixed on screen (no cursor pivot).

export const POSTCARD_MIN_SCALE = 0.5;
export const POSTCARD_MAX_SCALE = 8;
// Viewport padding for the initial fit (image is fit-contained on open).
export const POSTCARD_FIT_PADDING_PX = 16;
// Wheel zoom feel: one notch (deltaY=100) ~= x1.16.
const WHEEL_ZOOM_BASE = 1.0015;
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 800;
// Pan clamp: at least this share of the smaller dimension (image vs viewport)
// stays on screen, so the image can never be flung away and lost.
const PAN_KEEP_FRACTION = 0.25;
// Double-tap (touch AND mouse) recognition window for the reset gesture.
export const DOUBLE_TAP_MAX_DELAY_MS = 300;
export const DOUBLE_TAP_MAX_DIST_PX = 12;

export function clampScale(s) {
  if (!Number.isFinite(s)) return 1;
  return Math.min(POSTCARD_MAX_SCALE, Math.max(POSTCARD_MIN_SCALE, s));
}

export function normalizeWheelDelta(deltaY, deltaMode = 0) {
  const dy = Number(deltaY) || 0;
  if (deltaMode === 1) return dy * WHEEL_LINE_PX;
  if (deltaMode === 2) return dy * WHEEL_PAGE_PX;
  return dy;
}

// Centered wheel zoom: only the scale changes — translation is untouched, so
// the image never shifts position and never pivots on the cursor.
export function applyWheelZoom(view, deltaY, deltaMode = 0) {
  const dy = normalizeWheelDelta(deltaY, deltaMode);
  if (dy === 0) return view;
  return { ...view, scale: clampScale(view.scale * Math.pow(WHEEL_ZOOM_BASE, -dy)) };
}

export function applyPinchZoom(view, prevDist, nextDist) {
  if (!(prevDist > 0) || !(nextDist > 0)) return view;
  return { ...view, scale: clampScale((view.scale * nextDist) / prevDist) };
}

export function pinchDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function pinchMidpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Contain-fit display size for a natural image inside a viewport (px).
// Returns null when any input is missing/non-positive.
export function fitSize(naturalW, naturalH, viewW, viewH, padding = POSTCARD_FIT_PADDING_PX) {
  if (!(naturalW > 0) || !(naturalH > 0) || !(viewW > 0) || !(viewH > 0)) return null;
  const fit = Math.min((viewW - 2 * padding) / naturalW, (viewH - 2 * padding) / naturalH);
  if (!(fit > 0)) return null;
  return { width: naturalW * fit, height: naturalH * fit };
}

export function clampPan(tx, ty, dispW, dispH, scale, viewW, viewH) {
  const w = dispW * scale;
  const h = dispH * scale;
  const limitX = Math.max(0, (w + viewW) / 2 - Math.min(viewW, w) * PAN_KEEP_FRACTION);
  const limitY = Math.max(0, (h + viewH) / 2 - Math.min(viewH, h) * PAN_KEEP_FRACTION);
  return {
    tx: Math.min(limitX, Math.max(-limitX, tx)),
    ty: Math.min(limitY, Math.max(-limitY, ty)),
  };
}

// True when two quick taps (each { t, x, y }) form a double-tap reset gesture.
export function isDoubleTap(prevTap, tap, maxDelayMs = DOUBLE_TAP_MAX_DELAY_MS, maxDistPx = DOUBLE_TAP_MAX_DIST_PX) {
  if (!prevTap || !tap) return false;
  if (tap.t - prevTap.t > maxDelayMs || tap.t < prevTap.t) return false;
  const dx = tap.x - prevTap.x;
  const dy = tap.y - prevTap.y;
  return dx * dx + dy * dy <= maxDistPx * maxDistPx;
}
