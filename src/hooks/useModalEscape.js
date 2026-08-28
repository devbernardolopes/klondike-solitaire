// hooks/useModalEscape.js
// Registers a modal with the global modal stack while open and closes it on
// "Escape" — but only when it is the topmost open modal. This prevents a single
// Escape keypress from dismissing a stacked parent modal (e.g. Main Menu) when
// the user intended to close the child on top of it (e.g. Theme).
//
// Focus-on-open is intentionally left to each modal's own effect so existing
// focus targets (dialog vs. first button vs. input) are preserved. This hook
// only owns Escape + stack bookkeeping.

import { useEffect, useRef } from 'react';
import { pushModal, popModal, isTopModal } from '../utils/modalStack.js';

/**
 * @param {object} props
 * @param {boolean} props.open        whether the modal is currently open
 * @param {() => void} props.onClose  invoked on Escape when this modal is topmost
 * @param {string} props.id           stable unique id for the modal
 * @param {number} props.z            stacking level (see modalStack.Z)
 * @param {boolean} [props.enabled]   when false, Escape does nothing (default true)
 */
export function useModalEscape({ open, onClose, id, z, enabled = true }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    pushModal(id, z);
    const onKey = (e) => {
      if (e.key === 'Escape' && enabled && isTopModal(id)) {
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      popModal(id);
    };
  }, [open, id, z, enabled]);
}
