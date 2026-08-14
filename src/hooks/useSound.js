// hooks/useSound.js
// Stub Howler wrapper with a no-op fallback if no sound files are loaded.
// Delegates to audio/soundManager.js (which is a console.log stub this pass).

import { useCallback } from 'react';
import { play as playSound, registerSound } from '../audio/soundManager.js';

/**
 * @returns {{ play: (key: string) => void, enabled: boolean, setEnabled: (v: boolean) => void }}
 */
export function useSound() {
  // TODO(next pass): read `enabled` from settings store; reflect a mute toggle.
  const enabled = true;

  const play = useCallback(
    (key) => {
      if (!enabled) return;
      playSound(key);
    },
    [enabled],
  );

  // ensure keys exist (idempotent)
  registerSound('deal');
  registerSound('flip');
  registerSound('move');
  registerSound('win');
  registerSound('invalid');

  return { play, enabled, setEnabled: () => {} };
}
