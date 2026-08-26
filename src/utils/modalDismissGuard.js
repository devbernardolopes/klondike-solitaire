// utils/modalDismissGuard.js
//
// Synchronous guard against the "stray synthesized click" that mobile browsers
// fire at the end of a touch gesture which closed a modal via its backdrop.
//
// When a modal is dismissed by tapping the backdrop (which on mobile sits on
// top of the toolbar FABs), the browser still synthesizes a `click` for that
// same tap. Because the backdrop is removed on dismiss, that click lands on the
// FAB underneath and would instantly re-open the very modal we just closed.
//
// We can't rely on React state here (it updates too late, after the click), so
// we use a plain module-level timestamp that the click handlers read directly:
// when a backdrop dismiss happens we mark the guard active for a short window,
// and every FAB click handler ignores the press while the guard is active.

// How long the guard stays active after a backdrop dismiss. This must be longer
// than the gap between pointerup (which closes the modal) and the synthesized
// click (typically a few ms on mobile), while short enough that a deliberate
// re-tap well after the dismiss still works.
const DISMISS_GUARD_MS = 350;

let guardUntil = 0;

/** Call when a modal is dismissed by an outside (backdrop) tap. */
export function markModalDismissed() {
  guardUntil = Date.now() + DISMISS_GUARD_MS;
}

/** True while the post-dismiss guard window is active (stray click expected). */
export function isModalDismissGuardActive() {
  return Date.now() < guardUntil;
}
