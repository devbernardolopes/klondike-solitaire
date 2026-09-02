// components/NewGameModal.jsx
// Dedicated 3-outcome "New Game" picker: Winning Deal / Random Shuffle / dismiss.
// NOT built on top of ConfirmModal: there, Escape and backdrop both map to a
// single onCancel, which would be unsafe here because both real choices are
// destructive (an accidental Escape must do nothing, not silently trigger
// Random Shuffle). We mirror ConfirmModal's visual chrome (theme CSS variables,
// panel/backdrop styling, focus-on-open, Escape-to-dismiss) but expose three
// explicit outcomes.

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
 * @param {boolean} props.canReplay      // whether the current deal has started
 * @param {() => void} props.onWinningDeal
 * @param {() => void} props.onRandomShuffle
 * @param {() => void} props.onDailyChallenge  // open the Daily Challenge calendar
 * @param {() => void} props.onSpecialEvents
 * @param {() => void} props.onDismiss   // Escape / backdrop click / explicit close — does nothing else
 */
export default function NewGameModal({ open, onReplay, canReplay, onWinningDeal, onRandomShuffle, onDailyChallenge, onSpecialEvents, onDismiss }) {
  const { t } = useTranslation();
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
    background: 'var(--ui-modal-panel-bg)',
    color: 'var(--ui-modal-panel-fg)',
    border: 'var(--ui-modal-panel-border)',
    borderRadius: 'var(--ui-modal-panel-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(90vw, 380px)',
    maxWidth: '100%',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('newGameModal.title')}
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
        <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>{t('newGameModal.title')}</h2>
        <ModalCloseButton onClick={onDismiss} />
        <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.45 }}>
          {t('newGameModal.prompt')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            ref={firstBtnRef}
            type="button"
            style={{ ...btn, textAlign: 'left' }}
            onClick={onWinningDeal}
          >
            {t('newGameModal.winningDeal')}{' '}
            <span style={{ fontWeight: 400, opacity: 0.8 }}>{t('newGameModal.winningDeal.desc')}</span>
          </button>
          <button
            type="button"
            style={{ ...btn, textAlign: 'left' }}
            onClick={onRandomShuffle}
          >
            {t('newGameModal.randomShuffle')}{' '}
            <span style={{ fontWeight: 400, opacity: 0.8 }}>{t('newGameModal.randomShuffle.desc')}</span>
          </button>
          <button
            type="button"
            style={{ ...btn, textAlign: 'left' }}
            onClick={onDailyChallenge}
          >
            {t('newGameModal.dailyChallenge')}{' '}
            <span style={{ fontWeight: 400, opacity: 0.8 }}>{t('newGameModal.dailyChallenge.desc')}</span>
          </button>
          <button
            type="button"
            style={{ ...btn, textAlign: 'left' }}
            onClick={onSpecialEvents}
          >
            {t('newGameModal.specialEvents')}{' '}
            <span style={{ fontWeight: 400, opacity: 0.8 }}>{t('newGameModal.specialEvents.desc')}</span>
          </button>
          <button
            type="button"
            disabled={!canReplay}
            style={{
              ...btn,
              background: 'var(--ui-modal-btn-bg-strong)',
              textAlign: 'left',
              opacity: canReplay ? 1 : 0.4,
              cursor: canReplay ? 'pointer' : 'not-allowed',
            }}
            onClick={onReplay}
          >
            {t('newGameModal.replay')}{' '}
            <span style={{ fontWeight: 400, opacity: 0.8 }}>{t('newGameModal.replay.desc')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
