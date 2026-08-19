// components/ConfirmModal.jsx
// Reusable, controlled confirmation dialog. Renders nothing when `open` is
// false. Drive it entirely via props so any part of the app can reuse it by
// supplying its own title / message / button labels / handlers.
//
// Styled with theme custom properties (not hard-coded colors) so it adapts to
// the active theme (classic / dark). Rendered inline in the tree — no portal —
// so it inherits variables from the .theme-* root container.

import { useEffect, useRef } from 'react';
import { useModalBackdrop } from './modalBackdrop.js';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} [props.title]
 * @param {string} props.message
 * @param {string} [props.confirmText]
 * @param {string} [props.cancelText]
 * @param {boolean} [props.hideCancel]
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 */
export default function ConfirmModal({
  open,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  hideCancel = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);
  const backdrop = useModalBackdrop(onCancel);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

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
    background: 'var(--card-face-bg)',
    color: 'var(--card-text-black)',
    border: 'var(--card-border)',
    borderRadius: 'var(--card-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(90vw, 360px)',
    maxWidth: '100%',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ?? message}
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
        {title && (
          <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700 }}>{title}</h2>
        )}
        <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.45 }}>{message}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {!hideCancel && (
            <button type="button" style={btn} onClick={onCancel}>
              {cancelText}
            </button>
          )}
          <button
            type="button"
            ref={confirmRef}
            style={{ ...btn, background: 'var(--ui-modal-btn-bg-strong)' }}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
