// components/ThemeModal.jsx
// Theme picker reached from the Main Menu. Replaces the old Theme + Deck
// <select> controls with a tabbed grid of visual tiles. Each tile is sized
// like the live card and renders the actual element it represents (no labels):
//   - Background: the felt color of each theme (Classic, Dark)
//   - Cards Back: the current card back
//   - Cards Face: one tile per registered deck renderer// Tabs always have exactly one active selection. Picking a tile activates it
// immediately. Mirrors the modal chrome of SettingsModal.jsx / StoreModal.jsx.

import { useEffect, useRef, useState } from 'react';
import { useModalBackdrop } from './modalBackdrop.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { getDeck, listDecks } from '../render/deck/deckRegistry.js';
import { getCardBack } from '../render/deck/cardBackRegistry.js';
import { fetchStoreCatalog } from '../data/storeCatalog.js';
import { useAuthStore } from '../hooks/useAuthStore.js';

const TABS = [
  { id: 'interface', label: 'Interface' },
  { id: 'background', label: 'Background' },
  { id: 'cardsBack', label: 'Cards Back' },
  { id: 'cardsFace', label: 'Cards Face' },
];

const FREE_BACKGROUNDS = ['classic', 'dark', 'midnight', 'forest', 'desert', 'emerald-depth', 'midnight-velvet', 'crimson-baize', 'desert-mirage'];

// A fixed representative card (Ace of Spades) used so every deck face tile
// clearly shows that deck's color/background differences.
const PREVIEW_SUIT = 'spades';
const PREVIEW_RANK = 1;

// Badge shown on a freshly-acquired theme item tile the first time the Theme
// modal is opened after purchase (cleared via useSettingsStore.seenThemeItemIds).
const NEW_BADGE = {
  position: 'absolute',
  top: 4,
  left: 4,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
  color: '#fff',
  background: 'var(--card-text-red, #d12b3b)',
  borderRadius: 4,
  padding: '2px 5px',
  pointerEvents: 'none',
};

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function ThemeModal({ open, onClose }) {
  const dialogRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);
  const theme = useSettingsStore((s) => s.theme);
  const interfaceTheme = useSettingsStore((s) => s.interfaceTheme);
  const deck = useSettingsStore((s) => s.deck);
  const cardBack = useSettingsStore((s) => s.cardBack);
  const setCardBack = useSettingsStore((s) => s.setCardBack);
  const seenThemeItemIds = useSettingsStore((s) => s.seenThemeItemIds);
  const markThemeItemsSeen = useSettingsStore((s) => s.markThemeItemsSeen);
  const ownedItemIds = useAuthStore((s) => s.ownedItemIds);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setInterfaceTheme = useSettingsStore((s) => s.setInterfaceTheme);
  const setDeck = useSettingsStore((s) => s.setDeck);
  const setThemeModalTab = useSettingsStore((s) => s.setThemeModalTab);
  const validTab = (t) => (TABS.some((x) => x.id === t) ? t : 'interface');
  const [activeTab, setActiveTab] = useState(() =>
    validTab(useSettingsStore.getState().themeModalTab),
  );
  const [catalogItems, setCatalogItems] = useState([]);
  const [newIds, setNewIds] = useState([]);

  useModalEscape({ open, onClose, id: 'theme', z: Z.CHILD });

  const dismissNew = (id) => {
    if (!id || !newIds.includes(id)) return;
    setNewIds((prev) => prev.filter((x) => x !== id));
    markThemeItemsSeen([id]);
  };

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    setActiveTab(validTab(useSettingsStore.getState().themeModalTab));
    fetchStoreCatalog()
      .then((data) => {
        setCatalogItems(data);
        const themeIds = data.filter((it) => it.kind === 'card_back' || it.kind === 'table_felt' || it.kind === 'deck').map((it) => it.id);
        const fresh = ownedItemIds.filter((id) => themeIds.includes(id) && !seenThemeItemIds.includes(id));
        setNewIds(fresh);
        if (fresh.length) markThemeItemsSeen(fresh);
      })
      .catch(() => setCatalogItems([]));
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
    width: 'min(90vw, 420px)',
    maxWidth: '100%',
    height: '85vh',
    display: 'flex',
    flexDirection: 'column',
  };

  // Tile sizing mirrors the live card geometry via CSS vars so the previews
  // match exactly what is rendered on the board for the current device.
  const tileBase = {
    position: 'relative',
    boxSizing: 'border-box',
    width: 'var(--card-width)',
    height: 'var(--card-height)',
    borderRadius: 'var(--card-radius)',
    border: '3px solid rgba(0,0,0,0.18)',
    cursor: 'pointer',
    padding: 0,
    backgroundSize: '100% 100%',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
  };

  const selectedBorder = {
    border: '3px solid var(--hint-source)',
  };

  const announce = (msg) => useUiStore.getState().setAnnounce(msg);

  const renderBackgroundTab = () => {
    const ownedFelts = catalogItems.filter((it) => it.kind === 'table_felt' && ownedItemIds.includes(it.id));
    const tiles = [
      ...FREE_BACKGROUNDS.map((asset_ref) => ({ asset_ref, id: null, label: asset_ref })),
      ...ownedFelts.map((it) => ({ asset_ref: it.asset_ref, id: it.id, label: it.name })),
    ];
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, var(--card-width))', gap: 14, justifyContent: 'center' }}>
        {tiles.map((t) => {
          const selected = t.asset_ref === theme;
          const isNew = t.id ? newIds.includes(t.id) : false;
          return (
            <button
              key={t.asset_ref}
              type="button"
              role="button"
              aria-pressed={selected}
              aria-label={`Background: ${t.label}${selected ? ' (selected)' : ''}${isNew ? ' (new)' : ''}`}
              onClick={() => {
                if (t.id) dismissNew(t.id);
                setTheme(t.asset_ref);
                announce(`${t.label} background selected`);
              }}
              style={{
                ...tileBase,
                ...(selected ? selectedBorder : null),
                background: 'none',
                display: 'inline-block',
                overflow: 'hidden',
              }}
            >
              <span
                className={`theme-${t.asset_ref}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  height: '100%',
                  borderRadius: 'var(--card-radius)',
                  background: 'var(--felt-bg, var(--felt-color))',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: '42%',
                    height: '52%',
                    borderRadius: 'var(--card-radius)',
                    background: 'var(--card-face-bg, #fbfbf7)',
                    border: '1px solid var(--card-border, rgba(0,0,0,0.18))',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
                    display: 'block',
                  }}
                />
              </span>
              {isNew && <span style={NEW_BADGE}>New</span>}
            </button>
          );
        })}
      </div>
    );
  };

  const renderInterfaceTab = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, var(--card-width))', gap: 14, justifyContent: 'center' }}>
      {FREE_BACKGROUNDS.slice(0, 2).map((t) => {
        const selected = t === interfaceTheme;
        return (
          <button
            key={t}
            type="button"
            role="button"
            aria-pressed={selected}
            aria-label={`Interface: ${t}${selected ? ' (selected)' : ''}`}
            onClick={() => {
              setInterfaceTheme(t);
              announce(`${t} interface selected`);
            }}
            className={`ui-${t}`}
            style={{
              ...tileBase,
              ...(selected ? selectedBorder : null),
              background: 'var(--ui-modal-btn-bg)',
              border: '1px solid var(--ui-modal-btn-border)',
              color: 'var(--ui-modal-fg)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700 }}>{t}</span>
          </button>
        );
      })}
    </div>
  );

  // Default (the active deck's own back) plus any owned card-back overrides,
  // driven by the store catalog so newly-purchased items appear automatically
  // on this tab using the same registry preview as the Store modal fallback.
  const renderCardsBackTab = () => {
    const ownedCardBacks = catalogItems.filter(
      (it) => it.kind === 'card_back' && ownedItemIds.includes(it.id),
    );
    const tiles = [
      { key: 'default', label: 'Default', img: getDeck(deck).renderBack() },
      ...ownedCardBacks.map((it) => {
        const back = getCardBack(it.asset_ref);
        return {
          key: it.asset_ref,
          id: it.id,
          label: back ? back.name : it.name,
          img: back ? back.renderBack() : getDeck(deck).renderBack(),
        };
      }),
    ];
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, var(--card-width))', gap: 14, justifyContent: 'center' }}>
        {tiles.map((t) => {
          const selected = t.key === cardBack;
          const isNew = t.id ? newIds.includes(t.id) : false;
          return (
            <button
              key={t.key}
              type="button"
              role="button"
              aria-pressed={selected}
              aria-label={`Cards Back: ${t.label}${selected ? ' (selected)' : ''}${isNew ? ' (new)' : ''}`}
              onClick={() => {
                if (t.id) dismissNew(t.id);
                setCardBack(t.key);
                announce(`${t.label} card back selected`);
              }}
              style={{
                ...tileBase,
                ...(selected ? selectedBorder : null),
                backgroundImage: `url(${t.img})`,
              }}
            >
              {isNew && <span style={NEW_BADGE}>New</span>}
            </button>
          );
        })}
      </div>
    );
  };

  // One tile per deck: the Ace of Spades face from that deck.
  const renderCardsFaceTab = () => {
    const ownedDecks = catalogItems.filter((it) => it.kind === 'deck' && ownedItemIds.includes(it.id));
    const tiles = listDecks()
      .map((d) => {
        const item = ownedDecks.find((it) => it.asset_ref === d);
        const img = getDeck(d).renderCard(PREVIEW_SUIT, PREVIEW_RANK);
        return { key: d, id: item?.id ?? null, label: d, img };
      });
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, var(--card-width))', gap: 14, justifyContent: 'center' }}>
        {tiles.map((t) => {
          const selected = t.key === deck;
          const faceImg = t.img;
          const isNew = t.id ? newIds.includes(t.id) : false;
          return (
            <button
              key={t.key}
              type="button"
              role="button"
              aria-pressed={selected}
              aria-label={`Cards Face: ${t.label}${selected ? ' (selected)' : ''}${isNew ? ' (new)' : ''}`}
              onClick={() => {
                if (t.id) dismissNew(t.id);
                setDeck(t.key);
                announce(`${t.label} cards selected`);
              }}
              style={{
                ...tileBase,
                ...(selected ? selectedBorder : null),
                backgroundImage: `url(${faceImg})`,
              }}
            >
              {isNew && <span style={NEW_BADGE}>New</span>}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Theme"
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
        zIndex: 3200,
        padding: 16,
      }}
    >
      <div style={panel}>
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>Theme</h2>
        <ModalCloseButton onClick={onClose} />

        <div
          role="tablist"
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 18,
            borderBottom: '1px solid var(--ui-modal-panel-border)',
            paddingBottom: 10,
          }}
        >
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setActiveTab(tab.id);
                  setThemeModalTab(tab.id);
                }}
                style={{
                  ...btn,
                  background: active ? 'var(--ui-modal-btn-bg-strong)' : 'var(--ui-modal-btn-bg)',
                  border: active
                    ? '1px solid var(--ui-modal-btn-border)'
                    : '1px solid transparent',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="modal-body-scroll" style={{ flex: 1, minHeight: 0 }}>
          {activeTab === 'interface' && renderInterfaceTab()}
          {activeTab === 'background' && renderBackgroundTab()}
          {activeTab === 'cardsBack' && renderCardsBackTab()}
          {activeTab === 'cardsFace' && renderCardsFaceTab()}
        </div>
      </div>
    </div>
  );
}
