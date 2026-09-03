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
import { useTranslation } from 'react-i18next';

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
  const contentRef = useRef(null);
  const [scrollMetrics, setScrollMetrics] = useState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
  const backdrop = useModalBackdrop(onClose);
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const leaderboardVisible = useAuthStore((s) => s.leaderboardVisible);
  const setLeaderboardVisible = useAuthStore((s) => s.setLeaderboardVisible);
  const cardEffects = useSettingsStore((s) => s.cardEffects);
  const bounce = useSettingsStore((s) => s.bounce);
  const ghostEcho = useSettingsStore((s) => s.ghostEcho);
  const ghostTrail = useSettingsStore((s) => s.ghostTrail);
  const shimmer = useSettingsStore((s) => s.shimmer);
  const uncover = useSettingsStore((s) => s.uncover);
  const winEnhanced = useSettingsStore((s) => s.winEnhanced);
  const winCascade = useSettingsStore((s) => s.winCascade);
  const hoverGlow = useSettingsStore((s) => s.hoverGlow);
  const tableTexture = useSettingsStore((s) => s.tableTexture);
  const boardFrame = useSettingsStore((s) => s.boardFrame);
  const cardShake = useSettingsStore((s) => s.cardShake);
  const centisecondsOn = useSettingsStore((s) => s.centisecondsOn);

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
    if (contentRef.current) observer?.observe(contentRef.current);
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
    maxHeight: '85vh',
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
      aria-label={t('settings.title')}
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
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>{t('settings.title')}</h2>
        <ModalCloseButton onClick={onClose} />

        <div style={{ position: 'relative', flex: '0 1 auto', minHeight: 0, overflow: 'hidden' }}>
        <div ref={scrollRef} className="modal-body-scroll" style={{ height: 'auto', maxHeight: 'calc(85vh - 74px)', overflowY: 'auto', paddingBottom: 12, boxSizing: 'border-box' }}>
        <div ref={contentRef}>
        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.language')}</label>
          <select
            value={language}
            onChange={(e) => useSettingsStore.getState().setLanguage(e.target.value)}
            style={selectStyle}
            aria-label={t('settings.language.aria')}
          >
            <option value="en">{t('settings.language.english')}</option>
            <option value="fr">{t('settings.language.french')}</option>
            <option value="de">{t('settings.language.german')}</option>
            <option value="it">{t('settings.language.italian')}</option>
            <option value="es">{t('settings.language.spanish')}</option>
            <option value="pt-BR">{t('settings.language.portugueseBR')}</option>
          </select>
        </div>

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.hand')}</label>
          <select
            value={handedness}
            onChange={(e) => onHandednessChange(e.target.value)}
            style={selectStyle}
          >
            <option value="left">{t('settings.hand.left')}</option>
            <option value="right">{t('settings.hand.right')}</option>
          </select>
        </div>

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.highlightCard')}</label>
          <ToggleSwitch
            checked={!!highlightCard}
            onChange={onHighlightCardChange}
            label={t('settings.highlightCard')}
          />
        </div>

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.foundationParticles')}</label>
          <ToggleSwitch
            checked={!!particles}
            onChange={onParticlesChange}
            label={t('settings.foundationParticles')}
          />
        </div>

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.cardShake')}</label>
          <ToggleSwitch
            checked={!!cardShake}
            onChange={(v) => useSettingsStore.getState().setCardShake(v)}
            label={t('settings.cardShake')}
          />
        </div>

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.centiseconds')}</label>
          <ToggleSwitch
            checked={!!centisecondsOn}
            onChange={(v) => useSettingsStore.getState().setCentisecondsOn(v)}
            label={t('settings.centiseconds.desc')}
          />
        </div>

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.cardEffects')}</label>
          <ToggleSwitch
            checked={!!cardEffects}
            onChange={(v) => useSettingsStore.getState().setCardEffects(v)}
            label={t('settings.cardEffects')}
          />
        </div>

        <div style={{ ...field, marginLeft: 16, opacity: cardEffects ? 1 : 0.5, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.cardBounce')}</label>
          <ToggleSwitch
            checked={!!bounce}
            onChange={(v) => useSettingsStore.getState().setBounce(v)}
            label={t('settings.cardBounce')}
            disabled={!cardEffects}
          />
        </div>

        {[['settings.cardFlipShimmer', shimmer, 'setShimmer'], ['settings.uncoverSparkle', uncover, 'setUncover'], ['settings.hoverGlow', hoverGlow, 'setHoverGlow']].map(([key, value, setter]) => (
          <div key={key} style={{ ...field, marginLeft: 16, opacity: cardEffects ? 1 : 0.5, marginBottom: 20 }}>
            <label style={{ fontSize: 14, fontWeight: 600 }}>{t(key)}</label>
            <ToggleSwitch checked={!!value} onChange={(v) => useSettingsStore.getState()[setter](v)} label={t(key)} disabled={!cardEffects} />
          </div>
        ))}

        <div style={{ ...field, marginLeft: 16, opacity: cardEffects ? 1 : 0.5, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.ghostEcho')}</label>
          <ToggleSwitch
            checked={!!ghostEcho}
            onChange={(v) => useSettingsStore.getState().setGhostEcho(v)}
            label={t('settings.ghostEcho')}
            disabled={!cardEffects}
          />
        </div>

        <div style={{ ...field, marginLeft: 16, opacity: cardEffects ? 1 : 0.5, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.ghostTrail')}</label>
          <ToggleSwitch
            checked={!!ghostTrail}
            onChange={(v) => useSettingsStore.getState().setGhostTrail(v)}
            label={t('settings.ghostTrail')}
            disabled={!cardEffects}
          />
        </div>

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.winCelebration')}</label>
          <ToggleSwitch
            checked={!!winCascade}
            onChange={(v) => useSettingsStore.getState().setWinCascade(v)}
            label={t('settings.winCelebration.desc')}
          />
        </div>
        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.enhancedWin')}</label>
          <ToggleSwitch
            checked={!!winEnhanced}
            onChange={(v) => useSettingsStore.getState().setWinEnhanced(v)}
            label={t('settings.enhancedWin')}
          />
        </div>

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.tableTexture')}</label>
          <ToggleSwitch
            checked={!!tableTexture}
            onChange={(v) => useSettingsStore.getState().setTableTexture(v)}
            label={t('settings.tableTexture')}
          />
        </div>

        <div style={{ ...field, marginBottom: 20 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.boardFrame')}</label>
          <ToggleSwitch
            checked={!!boardFrame}
            onChange={(v) => useSettingsStore.getState().setBoardFrame(v)}
            label={t('settings.boardFrame')}
          />
        </div>

        <div style={{ ...field, marginBottom: 0 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t('settings.appearLeaderboard')}</label>
          <ToggleSwitch
            checked={!!leaderboardVisible}
            onChange={(v) => setLeaderboardVisible(v)}
            label={t('settings.appearLeaderboard')}
            disabled={!supabase}
          />
        </div>
        </div>
        </div>
        {showScrollUp && <button type="button" aria-label={t('settings.scrollTop')} onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} style={{ ...scrollButton, top: 8 }}><ChevronUp size={18} strokeWidth={2.5} aria-hidden="true" /></button>}
        {showScrollDown && <button type="button" aria-label={t('settings.scrollBottom')} onClick={() => { const element = scrollRef.current; element?.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }); }} style={{ ...scrollButton, bottom: 8 }}><ChevronDown size={18} strokeWidth={2.5} aria-hidden="true" /></button>}
        </div>
      </div>
    </div>
  );
}
