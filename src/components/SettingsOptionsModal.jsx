// components/SettingsOptionsModal.jsx
// "Settings" sub-modal reached from the Main Menu. Holds the Hand, Highlight
// Card, and Foundation Particles preferences. Mirrors the visual chrome and
// dismissal behavior (close button top-right, Escape / outside-tap to close, and
// tapping its own trigger while open) of ThemeModal.jsx / SettingsModal.jsx.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import ToggleSwitch from './ToggleSwitch.jsx';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { supabase } from '../lib/supabaseClient.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {'left'|'right'} props.handedness  board pile arrangement
 * @param {(h: 'left'|'right') => void} props.onHandednessChange
 * @param {boolean} props.highlightCard  draw the focus outline on the focused card
 * @param {(v: boolean) => void} props.onHighlightCardChange
 * @param {boolean} props.particles  enable the foundation suit-burst effect
 * @param {(v: boolean) => void} props.onParticlesChange
 */
export default function SettingsOptionsModal({
  open,
  onClose,
  handedness,
  onHandednessChange,
  highlightCard,
  onHighlightCardChange,
  particles,
  onParticlesChange,
}) {
  const dialogRef = useRef(null);
  const scrollRef = useRef(null);
  const [scrollMetrics, setScrollMetrics] = useState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
  const backdrop = useModalBackdrop(onClose);
  const leaderboardVisible = useAuthStore((s) => s.leaderboardVisible);
  const setLeaderboardVisible = useAuthStore((s) => s.setLeaderboardVisible);
  const cardEffects = useSettingsStore((s) => s.cardEffects);
  const bounce = useSettingsStore((s) => s.bounce);
  const ghostTrail = useSettingsStore((s) => s.ghostTrail);
  const shimmer = useSettingsStore((s) => s.shimmer);
  const uncover = useSettingsStore((s) => s.uncover);
  const winEnhanced = useSettingsStore((s) => s.winEnhanced);
  const winCascade = useSettingsStore((s) => s.winCascade);
  const hoverGlow = useSettingsStore((s) => s.hoverGlow);
  const tableTexture = useSettingsStore((s) => s.tableTexture);
  const boardFrame = useSettingsStore((s) => s.boardFrame);

  useModalEscape({ open, onClose, id: 'settings-options', z: Z.CHILD });

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
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
    overflow: 'hidden',
  };

  const showScrollUp = scrollMetrics.scrollTop > 0;
  const showScrollDown = scrollMetrics.scrollTop + scrollMetrics.clientHeight < scrollMetrics.scrollHeight - 1;
  const scrollButton = { position: 'absolute', left: '50%', transform: 'translateX(-50%)', width: 34, height: 28, display: 'grid', placeItems: 'center', padding: 0, border: '1px solid var(--ui-modal-panel-border)', borderRadius: 999, background: 'color-mix(in srgb, var(--ui-modal-panel-bg) 82%, transparent)', color: 'var(--ui-modal-panel-fg)', boxShadow: '0 2px 8px rgba(0,0,0,0.22)', backdropFilter: 'blur(4px)', cursor: 'pointer', zIndex: 1 };

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

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      tabIndex={-1}
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
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>Settings</h2>
        <ModalCloseButton onClick={onClose} />

        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={scrollRef} className="modal-body-scroll" style={{ height: '100%' }}>
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

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>Card Effects</label>
          <ToggleSwitch
            checked={!!cardEffects}
            onChange={(v) => useSettingsStore.getState().setCardEffects(v)}
            label="Card Effects"
          />
        </div>

        <div style={{ ...field, marginLeft: 16, opacity: cardEffects ? 1 : 0.5, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>Card Bounce</label>
          <ToggleSwitch
            checked={!!bounce}
            onChange={(v) => useSettingsStore.getState().setBounce(v)}
            label="Card Bounce"
            disabled={!cardEffects}
          />
        </div>

        {[['Card Flip Shimmer', shimmer, 'setShimmer'], ['Uncover Sparkle', uncover, 'setUncover'], ['Hover Glow / Drop Highlight', hoverGlow, 'setHoverGlow']].map(([label, value, setter]) => (
          <div key={label} style={{ ...field, marginLeft: 16, opacity: cardEffects ? 1 : 0.5, marginBottom: 20 }}>
            <label style={{ fontSize: 14, fontWeight: 600 }}>{label}</label>
            <ToggleSwitch checked={!!value} onChange={(v) => useSettingsStore.getState()[setter](v)} label={label} disabled={!cardEffects} />
          </div>
        ))}

        <div style={{ ...field, marginLeft: 16, opacity: cardEffects ? 1 : 0.5, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>Ghost Trail</label>
          <ToggleSwitch
            checked={!!ghostTrail}
            onChange={(v) => useSettingsStore.getState().setGhostTrail(v)}
            label="Ghost Trail"
            disabled={!cardEffects}
          />
        </div>

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>Win Celebration</label>
          <ToggleSwitch
            checked={!!winCascade}
            onChange={(v) => useSettingsStore.getState().setWinCascade(v)}
            label="Falling Cards on Win"
          />
        </div>
        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>Enhanced Win Celebration</label>
          <ToggleSwitch
            checked={!!winEnhanced}
            onChange={(v) => useSettingsStore.getState().setWinEnhanced(v)}
            label="Enhanced Win Celebration"
          />
        </div>

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>Table Texture</label>
          <ToggleSwitch
            checked={!!tableTexture}
            onChange={(v) => useSettingsStore.getState().setTableTexture(v)}
            label="Table Texture"
          />
        </div>

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>Board Frame</label>
          <ToggleSwitch
            checked={!!boardFrame}
            onChange={(v) => useSettingsStore.getState().setBoardFrame(v)}
            label="Board Frame"
          />
        </div>

        <div style={{ ...field, marginBottom: 0 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>Appear on Leaderboard</label>
          <ToggleSwitch
            checked={!!leaderboardVisible}
            onChange={(v) => setLeaderboardVisible(v)}
            label="Appear on Leaderboard"
            disabled={!supabase}
          />
        </div>
        </div>
        {showScrollUp && <button type="button" aria-label="Scroll settings to top" onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} style={{ ...scrollButton, top: 8 }}><ChevronUp size={18} strokeWidth={2.5} aria-hidden="true" /></button>}
        {showScrollDown && <button type="button" aria-label="Scroll settings to bottom" onClick={() => { const element = scrollRef.current; element?.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }); }} style={{ ...scrollButton, bottom: 8 }}><ChevronDown size={18} strokeWidth={2.5} aria-hidden="true" /></button>}
        </div>
      </div>
    </div>
  );
}
