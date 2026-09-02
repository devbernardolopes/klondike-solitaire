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
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Coins as CoinsIcon } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { supabase } from '../lib/supabaseClient.js';
import { fetchStoreCatalog, isThemeKind } from '../data/storeCatalog.js';
import { storeItemImageUrl, onStoreItemImageError } from '../utils/storeItemImage.js';
import { getCardBack } from '../render/deck/cardBackRegistry.js';
import { translateStoreItem } from '../i18n/db.js';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function StoreModal({ open, onClose }) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const scrollRef = useRef(null);
  const [scrollMetrics, setScrollMetrics] = useState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
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
      .then((data) => setItems(data.map(translateStoreItem)))
      .catch(() => setItems([]));
  }, [open]);

  useEffect(() => {
    if (!open) {
      setScrollMetrics({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
      return undefined;
    }
    const element = scrollRef.current;
    if (!element) return undefined;
    const update = () => setScrollMetrics({ scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight });
    element.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [open, items, ownedItemIds, coins, error]);

  if (!open) return null;

  const doBuy = async (item) => {
    setError(null);
    setBusyId(item.id);
    try {
      await purchaseItem(item.id, item.price);
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
    background: 'var(--ui-modal-panel-bg)',
    color: 'var(--ui-modal-panel-fg)',
    border: 'var(--ui-modal-panel-border)',
    borderRadius: 'var(--ui-modal-panel-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(90vw, 420px)',
    maxWidth: '100%',
    height: '85vh',
    display: 'flex',
    flexDirection: 'column',
  };
  const showScrollUp = scrollMetrics.scrollTop > 0;
  const showScrollDown = scrollMetrics.scrollTop + scrollMetrics.clientHeight < scrollMetrics.scrollHeight - 1;
  const scrollButton = {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 34,
    height: 28,
    display: 'grid',
    placeItems: 'center',
    padding: 0,
    border: '1px solid var(--ui-modal-panel-border)',
    borderRadius: 999,
    background: 'color-mix(in srgb, var(--ui-modal-panel-bg) 82%, transparent)',
    color: 'var(--ui-modal-panel-fg)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
    backdropFilter: 'blur(4px)',
    cursor: 'pointer',
    zIndex: 1,
  };

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
      if (item.kind === 'table_felt') {
        return (
          <span
            aria-hidden="true"
            className={`theme-${item.asset_ref}`}
            style={{
              ...previewSize,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--felt-color)',
            }}
          >
            <span
              style={{
                width: '60%',
                height: '58%',
                borderRadius: 4,
                background: 'var(--card-face-bg, #fbfbf7)',
                border: '1px solid rgba(0,0,0,0.18)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
                display: 'block',
              }}
            />
          </span>
        );
      }
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
      aria-label={t('store.title')}
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
        <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>{t('store.title')}</h2>
        <ModalCloseButton onClick={onClose} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 16, fontWeight: 700, marginBottom: 12, flex: '0 0 auto' }}>
          <CoinsIcon size={16} aria-hidden="true" />
          <span>{coins}</span>
        </div>

        {error && (
          <div style={{ color: '#d12b3b', fontSize: 13, marginBottom: 12, flex: '0 0 auto' }}>{error}</div>
        )}

        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={scrollRef} className="modal-body-scroll" style={{ height: '100%' }}>

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
                  <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>{t('common.owned')}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmItem(item)}
                    disabled={!canAfford || busyId === item.id}
                    aria-disabled={!canAfford}
                    style={{
                      ...btn,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      opacity: !canAfford ? 0.5 : 1,
                      cursor: !canAfford ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <CoinsIcon size={12} aria-hidden="true" /> {item.price}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {showScrollUp && (
          <button type="button" aria-label={t('store.scrollTop')} onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} style={{ ...scrollButton, top: 8 }}>
            <ChevronUp size={18} strokeWidth={2.5} aria-hidden="true" />
          </button>
        )}
        {showScrollDown && (
          <button type="button" aria-label={t('store.scrollBottom')} onClick={() => { const element = scrollRef.current; element?.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }); }} style={{ ...scrollButton, bottom: 8 }}>
            <ChevronDown size={18} strokeWidth={2.5} aria-hidden="true" />
          </button>
        )}
        </div>
      </div>

      <ConfirmModal
        open={!!confirmItem}
        title={t('store.confirm.title')}
        message={confirmItem ? t('store.confirm.message', { name: confirmItem.name, price: confirmItem.price }) : ''}
        confirmText={t('common.buy')}
        cancelText={t('common.cancel')}
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
        title={infoItem ? t('store.success.title', { name: infoItem.name }) : ''}
        message={infoItem ? t('store.success.message', { name: infoItem.name, tab: t({ card_back: 'store.tab.cardBack', table_felt: 'store.tab.background', deck: 'store.tab.cardsFace' }[infoItem.kind] || 'store.tab.interface') }) : ''}
        confirmText={t('common.ok')}
        hideCancel
        zIndex={Z.GRANDCHILD}
        z={Z.GRANDCHILD}
        onConfirm={() => setInfoItem(null)}
        onCancel={() => setInfoItem(null)}
      />
    </div>
  );
}
