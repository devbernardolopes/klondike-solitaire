// components/StoreModal.jsx
// Deliberate visual-only stub of the in-game store. Shows the player's coin
// balance and a few placeholder items with prices + "Coming soon" badges, but
// has NO purchase logic, inventory, or persistence yet. Reached from Settings.
// Mirrors the visual chrome (panel/backdrop, focus-on-open, Escape/backdrop-to-
// close) of SettingsModal.jsx. Out of scope for this pass: real purchasing,
// owned-item tracking, coin spending.

import { useEffect, useRef, useState } from 'react';
import { Coins as CoinsIcon } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useAuthStore } from '../hooks/useAuthStore.js';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function StoreModal({ open, onClose }) {
  const dialogRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);
  const coins = useAuthStore((s) => s.coins);

  // Placeholder catalog — prices are display-only for now.
  const items = [
    { id: 'dark-deck', name: 'Dark Deck', price: 50 },
    { id: '4-color-deck', name: '4-Color Deck', price: 50 },
    { id: 'card-back-blue', name: 'Card Back: Blue', price: 25 },
    { id: 'hint-token', name: 'Hint Token', price: 10 },
  ];

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
    background: 'var(--card-face-bg)',
    color: 'var(--card-text-black)',
    border: 'var(--card-border)',
    borderRadius: 'var(--card-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(90vw, 420px)',
    maxWidth: '100%',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Store"
      tabIndex={-1}
      ref={dialogRef}
      {...backdrop}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3100,
        padding: 16,
      }}
    >
      <div style={panel}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700 }}>Store</h2>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 16,
            fontWeight: 700,
            marginBottom: 6,
          }}
        >
          <CoinsIcon size={16} aria-hidden="true" />
          <span>{coins}</span>
        </div>

        <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 16 }}>
          The store is coming soon — deck themes and helpful items will be purchasable with coins.
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 12,
            marginBottom: 18,
          }}
        >
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                position: 'relative',
                border: '1px solid var(--card-border)',
                borderRadius: 'var(--card-radius)',
                padding: '12px',
                opacity: 0.5,
                pointerEvents: 'none',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{item.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                <CoinsIcon size={13} aria-hidden="true" />
                <span>{item.price}</span>
              </div>
              <div
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  background: 'var(--ui-modal-btn-bg-strong)',
                  color: 'var(--ui-modal-fg)',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                Coming soon
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
