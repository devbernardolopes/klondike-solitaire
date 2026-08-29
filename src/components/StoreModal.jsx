// components/StoreModal.jsx
// Store reached from Settings. Fetches the store_items catalog (public read)
// and cross-references useAuthStore's ownedItemIds to show Buy/Owned per
// item. purchase_item() is the only write path — see migration 007.
//
// Theme-related items (e.g. card backs) render with the SAME technique as the
// Theme modal when they have no image_path: the card-back registry preview.
// Buying is gated behind a confirmation dialog, and a successful purchase of a
// theme item shows an info dialog pointing the user to the right Theme tab.

import { useEffect, useRef, useState } from 'react';
import { Coins as CoinsIcon } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { supabase } from '../lib/supabaseClient.js';
import { fetchStoreCatalog, isThemeKind, tabLabelForKind } from '../data/storeCatalog.js';
import { storeItemImageUrl, onStoreItemImageError } from '../utils/storeItemImage.js';
import { getCardBack } from '../render/deck/cardBackRegistry.js';

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
  const [confirmItem, setConfirmItem] = useState(null);
  const [infoItem, setInfoItem] = useState(null);

  useModalEscape({ open, onClose, id: 'store', z: Z.CHILD });

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    fetchStoreCatalog()
      .then((data) => setItems(data))
      .catch(() => setItems([]));
  }, [open]);

  if (!open) return null;

  const doBuy = async (item) => {
    setError(null);
    setBusyId(item.id);
    try {
      await purchaseItem(item.id);
      setInfoItem(item);
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
    position: 'relative',
    background: 'var(--card-face-bg)',
    color: 'var(--card-text-black)',
    border: 'var(--card-border)',
    borderRadius: 'var(--card-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(90vw, 420px)',
    maxWidth: '100%',
  };

  // Renders a store item's visual the same way the Theme modal does for theme
  // items: an image when present, otherwise the card-back registry preview for
  // theme kinds, otherwise nothing (caller shows the text name beside it).
  const renderPreview = (item) => {
    const imgUrl = storeItemImageUrl(item.image_path);
    const previewSize = { width: 46, height: 64, borderRadius: 6, border: '1px solid var(--card-border)', flex: '0 0 auto' };
    if (imgUrl) {
      return (
        <img
          src={imgUrl}
          alt=""
          onError={onStoreItemImageError}
          style={{ ...previewSize, objectFit: 'cover', background: 'var(--card-face-bg)' }}
        />
      );
    }
    if (isThemeKind(item.kind)) {
      const back = getCardBack(item.asset_ref);
      if (back) {
        return (
          <span
            aria-hidden="true"
            style={{ ...previewSize, display: 'inline-block', backgroundImage: `url(${back.renderBack()})`, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat' }}
          />
        );
      }
    }
    return <span aria-hidden="true" style={{ ...previewSize, background: 'var(--card-face-bg)' }} />;
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
                  gap: 12,
                  marginBottom: 10,
                }}
              >
                {renderPreview(item)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{item.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{item.description}</div>
                </div>
                {owned ? (
                  <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>Owned</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmItem(item)}
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

      <ConfirmModal
        open={!!confirmItem}
        title="Confirm purchase"
        message={confirmItem ? `Buy ${confirmItem.name} for ${confirmItem.price} coins?` : ''}
        confirmText="Buy"
        cancelText="Cancel"
        zIndex={Z.GRANDCHILD}
        z={Z.GRANDCHILD}
        onConfirm={() => {
          const item = confirmItem;
          setConfirmItem(null);
          if (item) doBuy(item);
        }}
        onCancel={() => setConfirmItem(null)}
      />

      <ConfirmModal
        open={!!infoItem}
        title={infoItem ? infoItem.name : ''}
        message={infoItem ? `${infoItem.name} is now available in the Theme modal under the ${tabLabelForKind(infoItem.kind)} tab.` : ''}
        confirmText="OK"
        hideCancel
        zIndex={Z.GRANDCHILD}
        z={Z.GRANDCHILD}
        onConfirm={() => setInfoItem(null)}
        onCancel={() => setInfoItem(null)}
      />
    </div>
  );
}
