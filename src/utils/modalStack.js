// utils/modalStack.js
// Tracks the currently-open modal dialogs as a LIFO stack so that global
// "Escape" handling (see useModalEscape) can target only the topmost modal
// instead of every open modal at once. Without this, a modal stacked on top of
// another (e.g. Theme over Main Menu) would both close on a single Escape.
//
// Each modal registers itself with a stable `id` and its stacking `z` (zIndex).
// A higher `z` wins; ties are broken by most-recently-opened (LIFO order).

// Stacking levels shared across the modals. Parents/standalone dialogs sit at
// BASE; modals launched from within another dialog sit at CHILD (above BASE);
// Help sits above both.
export const Z = {
  BASE: 3000,
  CHILD: 3100,
  GRANDCHILD: 3200,
  HELP: 4000,
};

/** @type {{ id: string, z: number }[]} */
const stack = [];

/** Register an open modal. Removes any prior entry with the same id first. */
export function pushModal(id, z) {
  popModal(id);
  stack.push({ id, z });
}

/** Remove a modal from the stack (on close / unmount). */
export function popModal(id) {
  const i = stack.findIndex((e) => e.id === id);
  if (i !== -1) stack.splice(i, 1);
}

/** True when the modal with `id` is the topmost open modal. */
export function isTopModal(id) {
  return stack.length > 0 && stack[stack.length - 1].id === id;
}
