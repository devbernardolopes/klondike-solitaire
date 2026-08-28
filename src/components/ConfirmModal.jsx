// components/ConfirmModal.jsx
// Reusable, controlled confirmation dialog. Renders nothing when `open` is
// false. Drive it entirely via props so any part of the app can reuse it by
// supplying its own title / message / button labels / handlers.
//
// Styled with theme custom properties (not hard-coded colors) so it adapts to
// the active theme (classic / dark). Rendered inline in the tree — no portal —
// so it inherits variables from the .theme-* root container.

import { useEffect, useRef, useId } from 'react';
import { useModalBackdrop } from './modalBackdrop.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';

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
 * @param {string} [props.tertiaryText]   optional third button label (rendered leftmost)
 * @param {() => void} [props.onTertiary]  handler for the optional third button
 * @param {string} [props.quaternaryText]  optional fourth button label (rendered leftmost, before tertiary)
 * @param {() => void} [props.onQuaternary] handler for the optional fourth button
 * @param {boolean} [props.dismissable]     when false, the modal cannot be dismissed by an
 *                                          outside click/tap or the Escape key — the user must
 *                                          pick a button explicitly (default true)
 * @param {() => void} [props.onCloseIcon]  handler for the top-right "X" close button. Defaults
 *                                          to `onCancel` so the X mirrors a dismiss/close.
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
  tertiaryText,
  onTertiary,
  quaternaryText,
  onQuaternary,
  dismissable = true,
  onCloseIcon,
}) {
  const confirmRef = useRef(null);
  const backdrop = useModalBackdrop(onCancel);
  const onCloseIconRef = useRef(onCloseIcon ?? onCancel);
  onCloseIconRef.current = onCloseIcon ?? onCancel;
  const modalId = useId();

  useModalEscape({ open, onClose: onCancel, id: modalId, z: Z.BASE, enabled: dismissable });

  useEffect(() => {
    if (!open || !dismissable) return;
    confirmRef.current?.focus();
  }, [open, dismissable]);

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
    position: 'relative',
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
      {...(dismissable ? backdrop : {})}
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
          <h2 style={{
            margin: '0 0 10px',
            fontSize: 18,
            fontWeight: 700,
            paddingRight: 36,
          }}>{title}</h2>
        )}
        <ModalCloseButton onClick={() => onCloseIconRef.current?.()} />
        <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.45 }}>{message}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {quaternaryText && onQuaternary && (
            <button type="button" style={btn} onClick={onQuaternary}>
              {quaternaryText}
            </button>
          )}
          {tertiaryText && onTertiary && (
            <button type="button" style={btn} onClick={onTertiary}>
              {tertiaryText}
            </button>
          )}
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
