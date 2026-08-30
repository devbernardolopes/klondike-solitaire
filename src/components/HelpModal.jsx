// components/HelpModal.jsx
// Keyboard-shortcuts help dialog. Rendered on top of the Settings modal (higher
// zIndex) so the user can review available shortcuts without leaving settings.
// Mirrors the visual chrome (theme CSS variables, panel/backdrop styling,
// focus-on-open, Escape/backdrop-to-close) of SettingsModal / StatisticsModal.

import { useEffect, useRef } from 'react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ModalCloseButton from './ModalCloseButton.jsx';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function HelpModal({ open, onClose }) {
  const dialogRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);

  // Read the close handler via a ref so this effect runs once per open (depends
  // only on `open`), not whenever the handler identity changes.
  useModalEscape({ open, onClose, id: 'help', z: Z.HELP });

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
  }, [open]);

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
    background: 'var(--ui-modal-panel-bg)',
    color: 'var(--ui-modal-panel-fg)',
    border: 'var(--ui-modal-panel-border)',
    borderRadius: 'var(--ui-modal-panel-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(90vw, 380px)',
    maxWidth: '100%',
  };

  const row = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '7px 0',
    borderBottom: '1px solid var(--ui-control-border)',
  };

  const shortcuts = [
    { keys: 'N', action: 'New game' },
    { keys: 'D', action: 'Draw from stock (recycles when stock is empty)' },
    { keys: 'U', action: 'Undo' },
    { keys: 'A', action: 'Auto-complete to foundations' },
    { keys: 'H', action: 'Show hints' },
    { keys: 'Enter / Space', action: 'Auto-move the focused card' },
  ];

  return (
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        {...backdrop}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 4000,
          padding: 16,
        }}
      >
      <div style={panel}>
        <h2 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>
          Keyboard Shortcuts
        </h2>
        <ModalCloseButton onClick={onClose} />

        <div>
          {shortcuts.map(({ keys, action }) => (
            <div key={keys} style={row}>
              <kbd
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 13,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 5,
                  border: '1px solid var(--ui-control-border)',
                  background: 'var(--ui-control-bg)',
                  color: 'var(--ui-control-fg)',
                  whiteSpace: 'nowrap',
                }}
              >
                {keys}
              </kbd>
              <span style={{ fontSize: 14, textAlign: 'right', flex: 1 }}>{action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
