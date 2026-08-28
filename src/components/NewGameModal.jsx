// components/NewGameModal.jsx
// Dedicated 3-outcome "New Game" picker: Winning Deal / Random Shuffle / dismiss.
// NOT built on top of ConfirmModal: there, Escape and backdrop both map to a
// single onCancel, which would be unsafe here because both real choices are
// destructive (an accidental Escape must do nothing, not silently trigger
// Random Shuffle). We mirror ConfirmModal's visual chrome (theme CSS variables,
// panel/backdrop styling, focus-on-open, Escape-to-dismiss) but expose three
// explicit outcomes.

import { useEffect, useRef } from 'react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { pullRemoteProfile } from '../sync/pullProfile.js';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onReplay    // restart the current game identically
 * @param {() => void} props.onWinningDeal
 * @param {() => void} props.onRandomShuffle
 * @param {() => void} props.onDailyChallenge  // open the Daily Challenge calendar
 * @param {() => void} props.onDismiss   // Escape / backdrop click / explicit close — does nothing else
 */
export default function NewGameModal({ open, onReplay, onWinningDeal, onRandomShuffle, onDailyChallenge, onDismiss }) {
  const firstBtnRef = useRef(null);
  const backdrop = useModalBackdrop(onDismiss);

  useModalEscape({ open, onClose: onDismiss, id: 'newgame', z: Z.BASE });

  useEffect(() => {
    if (!open) return;
    firstBtnRef.current?.focus();
  }, [open]);

  // Pull the linked account's latest progress when the picker opens, so a fresh
  // deal starts from the most recent cross-device state.
  useEffect(() => {
    if (open && !useAuthStore.getState().isAnonymous) {
      pullRemoteProfile().catch((e) => console.error('New Game profile pull failed', e));
    }
  }, [open]);

  if (!open) return null;

  // Copied verbatim from ConfirmModal.jsx so the dialog matches the active theme.
  const btn = {
    padding: '8px 14px',
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
    background: 'var(--card-face-bg)',
    color: 'var(--card-text-black)',
    border: 'var(--card-border)',
    borderRadius: 'var(--card-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(90vw, 380px)',
    maxWidth: '100%',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New Game"
      {...backdrop}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
        padding: 16,
      }}
    >
      <div style={panel}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>New Game</h2>
        <ModalCloseButton onClick={onDismiss} />
        <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.45 }}>
          Current progress will be lost. Choose how to deal the new game:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            ref={firstBtnRef}
            type="button"
            style={{ ...btn, textAlign: 'left' }}
            onClick={onWinningDeal}
          >
            Winning Deal{' '}
            <span style={{ fontWeight: 400, opacity: 0.8 }}>— guaranteed solvable</span>
          </button>
          <button
            type="button"
            style={{ ...btn, textAlign: 'left' }}
            onClick={onRandomShuffle}
          >
            Random Shuffle{' '}
            <span style={{ fontWeight: 400, opacity: 0.8 }}>— true random, may be unwinnable</span>
          </button>
          <button
            type="button"
            style={{ ...btn, textAlign: 'left' }}
            onClick={onDailyChallenge}
          >
            Daily Challenge{' '}
            <span style={{ fontWeight: 400, opacity: 0.8 }}>— a new deal every day</span>
          </button>
          <button
            type="button"
            style={{ ...btn, background: 'var(--ui-modal-btn-bg-strong)', textAlign: 'left' }}
            onClick={onReplay}
          >
            Replay this Game{' '}
            <span style={{ fontWeight: 400, opacity: 0.8 }}>— restart the same deal</span>
          </button>
        </div>
      </div>
    </div>
  );
}
