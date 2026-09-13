// utils/keyClick.js
// Pure, framework-free core of the Z/X-as-mouse emulation (see
// hooks/useKeyClick.js for the React wiring). Zero imports so it stays
// unit-testable in isolation under plain `node --test`, mirroring `core/`.
//
// When the `zxClick` setting is on, pressing Z fires a synthetic left-button
// single-click at the current cursor position and pressing X fires a synthetic
// left-button double-click there.
//
// Why synthetic events (rather than calling game actions directly):
//   - The request is "works anywhere like the mouse does" — cards, piles,
//     toolbar buttons, menus, modals, empty board space. The only faithful way
//     to do that is to hit-test whatever is under the cursor
//     (`document.elementFromPoint`) and dispatch the same event sequence a real
//     mouse produces, so every existing handler (React onClick, CardView's
//     onPointerDown/onPointerUp auto-move, Board's onPointerUp double-tap
//     auto-complete, dnd-kit, GameModeLabel's onDoubleClick, …) behaves exactly
//     as if the mouse had been clicked — with zero per-component changes.
//   - Cards listen to pointerdown/pointerup (not click) and the board's empty-
//     space auto-complete listens to pointerup, so a bare `click` event alone
//     would NOT move cards. The full sequence below (pointer + mouse + click,
//     plus a trailing dblclick for X) is required.
//
// Hold-to-repeat: OS key auto-repeat emits repeated `keydown` events while the
// key is held. Repeats are deliberately NOT ignored here, so holding Z or X
// fires continuously at the OS repeat rate — no extra code needed.
//
// Focus mimicry: a real click moves focus to the nearest focusable ancestor.
// Synthetic clicks do not, so we focus it manually (best-effort) to keep
// keyboard/focus continuity identical to a real click.

// Last known cursor position in client coordinates. Updated on every pointer
// move (mouse move covers trackpads; touch pointers update it too, but there is
// no hover cursor on touch so the feature is primarily a mouse/trackpad aid).
// Module-level so the keydown handler always sees the freshest position without
// re-subscribing, and so tests can seed it via `setLastPointerForTest`.
const lastPointer = { x: null, y: null };

/** Record the cursor position from a pointer/mouse move event. */
export function trackPointerPosition(e) {
  if (e == null || typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return;
  lastPointer.x = e.clientX;
  lastPointer.y = e.clientY;
}

/** @param {EventTarget|null} target true when typing into it must win over click emulation. */
export function isEditableTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const el = /** @type {any} */ (target);
  if (el.isContentEditable) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * @param {string} key a KeyboardEvent.key value
 * @returns {'single'|'double'|null} the click action for Z/X, else null
 */
export function resolveKeyAction(key) {
  if (typeof key !== 'string') return null;
  const k = key.toLowerCase();
  if (k === 'z') return 'single';
  if (k === 'x') return 'double';
  return null;
}

/**
 * Decide whether a keydown should fire a synthetic click.
 * @param {KeyboardEvent} e
 * @param {boolean} isEnabled the `zxClick` setting
 * @returns {'single'|'double'|null} the action to fire, or null to ignore.
 *   e.repeat is intentionally honored (hold-to-repeat via OS key repeat).
 */
export function shouldFireKeyClick(e, isEnabled) {
  if (!isEnabled) return null;
  if (!e || e.metaKey || e.ctrlKey || e.altKey) return null;
  const action = resolveKeyAction(e.key);
  if (!action) return null;
  // Typing into a field must type the letter, never click.
  if (isEditableTarget(e.target)) return null;
  return action;
}

function makePointerEvent(type, x, y, extra = {}) {
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: typeof window !== 'undefined' ? window : null,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    button: 0,
    buttons: type === 'pointerdown' ? 1 : 0,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    ...extra,
  };
  if (typeof PointerEvent !== 'undefined') {
    try {
      return new PointerEvent(type, init);
    } catch {}
  }
  return new MouseEvent(type, init);
}

function makeMouseEvent(type, x, y, extra = {}) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: typeof window !== 'undefined' ? window : null,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    button: 0,
    buttons: type === 'mousedown' ? 1 : 0,
    ...extra,
  });
}

/**
 * Focus the nearest focusable ancestor, mimicking what a real mouse click does
 * (synthetic clicks never move focus on their own). Best-effort: never throws.
 * @param {Element} el the hit-tested element
 */
function mimicClickFocus(el) {
  try {
    const focusable = el.closest
      ? el.closest('[tabindex],button,a[href],input,select,textarea,[role="button"]')
      : null;
    const node = focusable || el;
    if (!node || typeof node.focus !== 'function') return;
    if (typeof node.hasAttribute === 'function' && node.hasAttribute('disabled')) return;
    const tabIndex = typeof node.getAttribute === 'function' ? node.getAttribute('tabindex') : null;
    if (tabIndex === '-1' && node !== document.activeElement) {
      // A tabindex=-1 node is programmatically focusable (cards use -1 for
      // locked cards); focusing it is still faithful to a real click, but skip
      // it when it is not already focused to avoid yanking focus to locked cards.
      return;
    }
    if (node !== document.activeElement) {
      // `focusVisible: false` opts out of `:focus-visible` styling. Without
      // it, this programmatic focus would match `:focus-visible` whenever the
      // browser is in keyboard modality — which it always is here, since a
      // Z/X keypress got us here — painting the keyboard-focus indicator
      // (e.g. the `[data-pile]:focus-visible` glow) on every emulated click.
      // A real mouse click never produces a `:focus-visible` ring, so opting
      // out keeps the emulation faithful. Unsupported browsers ignore the
      // unknown option and fall back to heuristic behavior (no throw).
      node.focus({ preventScroll: true, focusVisible: false });
    }
  } catch {}
}

/**
 * Dispatch a single left-button click sequence on `el`.
 * Real order: pointerdown → mousedown → (focus) → pointerup → mouseup → click.
 */
function fireSingleClick(el, x, y, clickCount) {
  el.dispatchEvent(makePointerEvent('pointerdown', x, y));
  el.dispatchEvent(makeMouseEvent('mousedown', x, y, { detail: clickCount }));
  mimicClickFocus(el);
  el.dispatchEvent(makePointerEvent('pointerup', x, y));
  el.dispatchEvent(makeMouseEvent('mouseup', x, y, { detail: clickCount }));
  el.dispatchEvent(makeMouseEvent('click', x, y, { detail: clickCount }));
}

/**
 * Fire a synthetic single left-click at the cursor position.
 * @returns {boolean} true when a click was dispatched
 */
export function fireSingleClickAtCursor() {
  if (typeof document === 'undefined') return false;
  const { x, y } = lastPointer;
  if (x == null || y == null) return false;
  const el = document.elementFromPoint(x, y);
  if (!el) return false;
  fireSingleClick(el, x, y, 1);
  return true;
}

/**
 * Fire a synthetic left-button double-click at the cursor position.
 * Real order: click-sequence ×2 (second with detail 2) → dblclick. The two
 * back-to-back pointerup events also satisfy Board's time-based (400ms)
 * empty-space double-tap detector, which pairs by time rather than native
 * dblclick.
 * @returns {boolean} true when the sequence was dispatched
 */
export function fireDoubleClickAtCursor() {
  if (typeof document === 'undefined') return false;
  const { x, y } = lastPointer;
  if (x == null || y == null) return false;
  const el = document.elementFromPoint(x, y);
  if (!el) return false;
  fireSingleClick(el, x, y, 1);
  fireSingleClick(el, x, y, 2);
  el.dispatchEvent(makeMouseEvent('dblclick', x, y, { detail: 2 }));
  return true;
}

/** Test seam: seed the cursor position without dispatching DOM events. */
export function setLastPointerForTest(x, y) {
  lastPointer.x = x;
  lastPointer.y = y;
}
