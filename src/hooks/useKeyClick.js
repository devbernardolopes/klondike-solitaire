// hooks/useKeyClick.js
// Thin React wiring for the Z/X-as-mouse emulation whose pure logic lives in
// utils/keyClick.js (dependency-free, unit-tested in isolation). Mount once at
// the App root so it works everywhere — board, toolbar, menus, modals, empty
// space. Active only while the `zxClick` setting is on.

import { useEffect } from 'react';
import { useSettingsStore } from './useSettingsStore.js';
import {
  trackPointerPosition,
  shouldFireKeyClick,
  fireSingleClickAtCursor,
  fireDoubleClickAtCursor,
} from '../utils/keyClick.js';

/**
 * Global Z/X → mouse emulation. Gated by the `zxClick` setting; guarded so
 * typing Z/X into inputs still types.
 */
export function useKeyClick() {
  useEffect(() => {
    // Capture phase so we see the position even when a child stops propagation.
    // `pointermove` covers mouse/trackpad/pen; `mousemove` is a fallback for
    // environments without PointerEvent.
    window.addEventListener('pointermove', trackPointerPosition, true);
    window.addEventListener('mousemove', trackPointerPosition, true);

    const onKeyDown = (e) => {
      // Read live via getState so toggling the setting takes effect without
      // rebinding the listener.
      const action = shouldFireKeyClick(e, useSettingsStore.getState().zxClick);
      if (action === 'single') fireSingleClickAtCursor();
      else if (action === 'double') fireDoubleClickAtCursor();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointermove', trackPointerPosition, true);
      window.removeEventListener('mousemove', trackPointerPosition, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
