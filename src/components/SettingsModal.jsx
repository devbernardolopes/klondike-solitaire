// components/SettingsModal.jsx
// Options/settings dialog holding the Theme, Deck, and Hand selectors that
// previously lived in the top toolbar. Mirrors the visual chrome (theme CSS
// variables, panel/backdrop styling, focus-on-open, Escape/backdrop-to-close)
// used by ConfirmModal.jsx / NewGameModal.jsx.

import { useEffect, useRef } from 'react';
import { HelpCircle } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useGameStore } from '../hooks/useGameStore.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { buildSnapshotText, snapshotModeToken } from '../core/snapshot.js';
import ToggleSwitch from './ToggleSwitch.jsx';
import HelpModal from './HelpModal.jsx';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} props.theme    active theme name
 * @param {(t: string) => void} props.onThemeChange
 * @param {string} props.deck     active deck/renderer name
 * @param {(d: string) => void} props.onDeckChange
 * @param {'left'|'right'} props.handedness  board pile arrangement
 * @param {(h: 'left'|'right') => void} props.onHandednessChange
 * @param {boolean} props.highlightCard  draw the focus outline on the focused card
 * @param {(v: boolean) => void} props.onHighlightCardChange
 * @param {boolean} props.particles  enable the foundation suit-burst effect
 * @param {(v: boolean) => void} props.onParticlesChange
 */
export default function SettingsModal({
  open,
  onClose,
  theme,
  onThemeChange,
  deck,
  onDeckChange,
  handedness,
  onHandednessChange,
  highlightCard,
  onHighlightCardChange,
  particles,
  onParticlesChange,
}) {
  const doneRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);
  const helpOpen = useUiStore((s) => s.helpDialogOpen);

  // Keep the latest close handler in a ref so the open-effect can depend only on
  // `open` (running exactly once per open) instead of on the handler identity.
  // Previously the effect listed the handler in its deps, so an unstable
  // callback — e.g. re-created on every 250ms clock tick — would re-fire it and
  // steal focus from an open <select>, snapping the dropdown shut.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    doneRef.current?.focus();
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
    width: 'min(90vw, 360px)',
    maxWidth: '100%',
  };

  const selectStyle = {
    padding: '6px 10px',
    borderRadius: 6,
    color: 'var(--ui-control-fg)',
    background: 'var(--ui-control-bg)',
    border: '1px solid var(--ui-control-border)',
    fontSize: 14,
    cursor: 'pointer',
  };

  const field = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  };

  // Local timestamp as YYYYMMDD-HHMMSS (no separators, sortable).
  const formatTimestamp = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
      `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    );
  };

  // Export the current visible board as a plain-text snapshot file.
  const openHelp = () => useUiStore.getState().setHelpDialogOpen(true);

  const handleTakeSnapshot = () => {
    const state = useGameStore.getState().state;
    const text = buildSnapshotText(state);
    const filename = `${formatTimestamp(new Date())}_${snapshotModeToken(state)}.txt`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    useUiStore.getState().setAnnounce('Board snapshot exported');
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
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
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Settings</h2>

        <div style={field}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>Theme</label>
          <select
            value={theme}
            onChange={(e) => onThemeChange(e.target.value)}
            style={selectStyle}
          >
            <option value="classic">Classic</option>
            <option value="dark">Dark</option>
            {/* TODO(next pass): register more themes */}
          </select>
        </div>

        <div style={field}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>Deck</label>
          <select
            value={deck}
            onChange={(e) => onDeckChange(e.target.value)}
            style={selectStyle}
          >
            <option value="procedural">Classic</option>
            <option value="sprite">Sprite (atlas)</option>
            <option value="4-color">4-color</option>
            <option value="4-color-2">4-color 2</option>
            <option value="procedural-dark">Dark</option>
            <option value="procedural-dark-2">Dark 2</option>
            {/* TODO(next pass): add real deck renderers */}
          </select>
        </div>

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>Hand</label>
          <select
            value={handedness}
            onChange={(e) => onHandednessChange(e.target.value)}
            style={selectStyle}
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </div>

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>Highlight Card</label>
          <ToggleSwitch
            checked={!!highlightCard}
            onChange={onHighlightCardChange}
            label="Highlight Card"
          />
        </div>

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>Foundation Particles</label>
          <ToggleSwitch
            checked={!!particles}
            onChange={onParticlesChange}
            label="Foundation Particles"
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts"
              style={{
                ...btn,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '8px 10px',
              }}
              onClick={openHelp}
            >
              <HelpCircle size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              style={{ ...btn }}
              onClick={handleTakeSnapshot}
            >
              Take Snapshot
            </button>
          </div>
          <button
            type="button"
            ref={doneRef}
            style={{ ...btn, background: 'var(--ui-modal-btn-bg-strong)' }}
            onClick={onClose}
          >
            Done
          </button>
        </div>

      </div>
    </div>

      <HelpModal
        open={helpOpen}
        onClose={() => useUiStore.getState().setHelpDialogOpen(false)}
      />
    </>
  );
}
