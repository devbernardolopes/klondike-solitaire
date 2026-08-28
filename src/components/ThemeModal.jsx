// components/ThemeModal.jsx
// Theme picker reached from the Main Menu. Replaces the old Theme + Deck
// <select> controls with a tabbed grid of visual tiles. Each tile is sized
// like the live card and renders the actual element it represents (no labels):
//   - Background: the felt color of each theme (Classic, Dark)
//   - Cards Back: the current card back
//   - Cards Face: one tile per deck renderer (excluding the sprite/atlas deck)
// Tabs always have exactly one active selection. Picking a tile activates it
// immediately. Mirrors the modal chrome of SettingsModal.jsx / StoreModal.jsx.

import { useEffect, useRef, useState } from 'react';
import { useModalBackdrop } from './modalBackdrop.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { getDeck, listDecks } from '../render/deck/deckRegistry.js';

const TABS = [
  { id: 'background', label: 'Background' },
  { id: 'cardsBack', label: 'Cards Back' },
  { id: 'cardsFace', label: 'Cards Face' },
];

const BACKGROUNDS = ['classic', 'dark'];

// A fixed representative card (Ace of Spades) used so every deck face tile
// clearly shows that deck's color/background differences.
const PREVIEW_SUIT = 'spades';
const PREVIEW_RANK = 1;

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function ThemeModal({ open, onClose }) {
  const dialogRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);
  const theme = useSettingsStore((s) => s.theme);
  const deck = useSettingsStore((s) => s.deck);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setDeck = useSettingsStore((s) => s.setDeck);
  const [activeTab, setActiveTab] = useState('background');

  useModalEscape({ open, onClose, id: 'theme', z: Z.CHILD });

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
    background: 'var(--card-face-bg)',
    color: 'var(--card-text-black)',
    border: 'var(--card-border)',
    borderRadius: 'var(--card-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(92vw, 560px)',
    maxWidth: '100%',
    height: '85vh',
    display: 'flex',
    flexDirection: 'column',
  };

  // Tile sizing mirrors the live card geometry via CSS vars so the previews
  // match exactly what is rendered on the board for the current device.
  const tileBase = {
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

  // One tile per background theme: the felt-color swatch, scoped to that theme's
  // CSS variables so the preview is accurate regardless of the active theme.
  const renderBackgroundTab = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, var(--card-width))', gap: 14 }}>
      {BACKGROUNDS.map((t) => {
        const selected = t === theme;
        return (
          <button
            key={t}
            type="button"
            role="button"
            aria-pressed={selected}
            aria-label={`Background: ${t}${selected ? ' (selected)' : ''}`}
            onClick={() => {
              setTheme(t);
              announce(`${t} background selected`);
            }}
            style={{
              ...tileBase,
              ...(selected ? selectedBorder : null),
              background: 'none',
              display: 'inline-block',
            }}
          >
            <span
              className={`theme-${t}`}
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                borderRadius: 'var(--card-radius)',
                background: 'var(--felt-color)',
              }}
            />
          </button>
        );
      })}
    </div>
  );

  // Single tile: the current card back. Always selected; clicking is a no-op
  // (there is only the current back for now).
  const renderCardsBackTab = () => {
    const backImg = getDeck(deck).renderBack();
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, var(--card-width))', gap: 14 }}>
        <button
          type="button"
          role="button"
          aria-pressed
          aria-label="Cards Back: current"
          onClick={() => {}}
          style={{
            ...tileBase,
            ...selectedBorder,
            backgroundImage: `url(${backImg})`,
          }}
        />
      </div>
    );
  };

  // One tile per (non-sprite) deck: the Ace of Spades face from that deck.
  const renderCardsFaceTab = () => {
    const faces = listDecks().filter((d) => d !== 'sprite');
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, var(--card-width))', gap: 14 }}>
        {faces.map((d) => {
          const selected = d === deck;
          const faceImg = getDeck(d).renderCard(PREVIEW_SUIT, PREVIEW_RANK);
          return (
            <button
              key={d}
              type="button"
              role="button"
              aria-pressed={selected}
              aria-label={`Cards Face: ${d}${selected ? ' (selected)' : ''}`}
              onClick={() => {
                setDeck(d);
                announce(`${d} cards selected`);
              }}
              style={{
                ...tileBase,
                ...(selected ? selectedBorder : null),
                backgroundImage: `url(${faceImg})`,
              }}
            />
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
            marginBottom: 18,
            borderBottom: '1px solid var(--card-border)',
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
                onClick={() => setActiveTab(tab.id)}
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
          {activeTab === 'background' && renderBackgroundTab()}
          {activeTab === 'cardsBack' && renderCardsBackTab()}
          {activeTab === 'cardsFace' && renderCardsFaceTab()}
        </div>
      </div>
    </div>
  );
}
