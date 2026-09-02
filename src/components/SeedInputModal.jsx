// components/SeedInputModal.jsx
// "Enter Seed" dialog: lets the user start a specific, pre-verified solvable
// (Winning Deal) game by typing its seed number. The text input accepts digits
// only; confirming a seed that is not in the solvable pool shows an inline error
// and does nothing else. Escape / backdrop / Cancel are all non-destructive
// (they never start a game), so modeled on NewGameModal's own-dialog pattern
// rather than ConfirmModal's single-cancel-shared-with-confirm semantics.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import { isSolvableSeed } from '../core/solvablePool.js';
import { getWinningPool } from '../repo/seedRepository.js';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {(seed: number) => void} props.onConfirm  called with a valid, existing seed
 * @param {() => void} props.onCancel              Escape / backdrop / Cancel — does nothing else
 */
export default function SeedInputModal({ open, onConfirm, onCancel }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const backdrop = useModalBackdrop(onCancel);

  useModalEscape({ open, onClose: onCancel, id: 'seed', z: Z.BASE });

  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setValue('');
    setError('');
    // Focus the input on open so the user can type immediately.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  if (!open) return null;

  // Keep only digits so the field can never contain a non-numeric character.
  const onChange = (e) => {
    setValue(e.target.value.replace(/[^0-9]/g, ''));
    if (error) setError('');
  };

  const tryConfirm = async () => {
    const trimmed = value.trim();
    if (trimmed === '') {
      setError(t('seedInput.error.empty'));
      return;
    }
    const seed = Number(trimmed);
    const pool = await getWinningPool();
    if (!isSolvableSeed(seed, pool)) {
      setError(t('seedInput.error.notFound', { seed }));
      return;
    }
    onConfirm(seed);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      tryConfirm();
    }
  };

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
    background: 'var(--ui-modal-panel-bg)',
    color: 'var(--ui-modal-panel-fg)',
    border: 'var(--ui-modal-panel-border)',
    borderRadius: 'var(--ui-modal-panel-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(90vw, 360px)',
    maxWidth: '100%',
  };

  const input = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    fontSize: 16,
    borderRadius: 6,
    border: '1px solid var(--ui-control-border)',
    background: 'var(--ui-control-bg)',
    color: 'var(--ui-control-fg)',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('seedInput.title')}
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
        <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700 }}>{t('seedInput.title')}</h2>
        <p style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.45 }}>
          {t('seedInput.prompt')}
        </p>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          aria-label={t('seedInput.aria')}
          aria-invalid={error ? 'true' : 'false'}
          placeholder={t('seedInput.placeholder')}
          style={input}
        />
        {error && (
          <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--ui-error-fg, #b00020)' }}>{error}</p>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: error ? 14 : 18 }}>
          <button type="button" style={btn} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={{ ...btn, background: 'var(--ui-modal-btn-bg-strong)' }}
            onClick={tryConfirm}
          >
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
