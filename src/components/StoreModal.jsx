// components/StoreModal.jsx
// Store reached from Settings. Fetches the store_items catalog (public read)
// and cross-references useAuthStore's ownedItemIds to show Buy/Owned per
// item. purchase_item() is the only write path — see migration 007.

import { useEffect, useRef, useState } from 'react';
import { Coins as CoinsIcon } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { supabase } from '../lib/supabaseClient.js';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function StoreModal({ open, onClose }) {
  const dialogRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);
  const coins = useAuthStore((s) => s.coins);
  const ownedItemIds = useAuthStore((s) => s.ownedItemIds);
  const purchaseItem = useAuthStore((s) => s.purchaseItem);

  const [items, setItems] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  useModalEscape({ open, onClose, id: 'store', z: Z.CHILD });

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    supabase
      .from('store_items')
      .select('id, name, description, price')
      .eq('enabled', true)
      .order('sort_order')
      .then(({ data }) => setItems(data ?? []));
  }, [open]);

  if (!open) return null;

  const handleBuy = async (item) => {
    setError(null);
    setBusyId(item.id);
    try {
      await purchaseItem(item.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
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
        <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>Store</h2>
        <ModalCloseButton onClick={onClose} />

        <div className="modal-body-scroll" style={{ flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
            <CoinsIcon size={16} aria-hidden="true" />
            <span>{coins}</span>
          </div>

          {error && (
            <div style={{ color: '#d12b3b', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}

          {items.map((item) => {
            const owned = ownedItemIds.includes(item.id);
            const canAfford = coins >= item.price;
            return (
              <div
                key={item.id}
                style={{
                  border: '1px solid var(--card-border)',
                  borderRadius: 'var(--card-radius)',
                  padding: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{item.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{item.description}</div>
                </div>
                {owned ? (
                  <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>Owned</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleBuy(item)}
                    disabled={!canAfford || busyId === item.id}
                    style={btn}
                  >
                    <CoinsIcon size={12} aria-hidden="true" /> {item.price}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
