// components/HelpModal.jsx
// Help dialog (keyboard shortcuts + mouse/touch controls). Rendered on top of
// the Settings modal (higher
// zIndex) so the user can review available shortcuts without leaving settings.
// Mirrors the visual chrome (theme CSS variables, panel/backdrop styling,
// focus-on-open, Escape/backdrop-to-close) of SettingsModal / StatisticsModal.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
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
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const scrollRef = useRef(null);
  const [scrollMetrics, setScrollMetrics] = useState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
  const backdrop = useModalBackdrop(onClose);

  // Read the close handler via a ref so this effect runs once per open (depends
  // only on `open`), not whenever the handler identity changes.
  useModalEscape({ open, onClose, id: 'help', z: Z.HELP });

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
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };
  const showScrollUp = scrollMetrics.scrollTop > 0;
  const showScrollDown = scrollMetrics.scrollTop + scrollMetrics.clientHeight < scrollMetrics.scrollHeight - 1;
  const scrollButton = { position: 'absolute', left: '50%', transform: 'translateX(-50%)', width: 34, height: 28, display: 'grid', placeItems: 'center', padding: 0, border: '1px solid var(--ui-modal-panel-border)', borderRadius: 999, background: 'color-mix(in srgb, var(--ui-modal-panel-bg) 82%, transparent)', color: 'var(--ui-modal-panel-fg)', boxShadow: '0 2px 8px rgba(0,0,0,0.22)', backdropFilter: 'blur(4px)', cursor: 'pointer', zIndex: 1 };

  const subtitle = {
    margin: '0 0 8px',
    fontSize: 14,
    fontWeight: 700,
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
    { keys: 'N', action: t('help.keys.newGame') },
    { keys: 'D', action: t('help.keys.draw') },
    { keys: 'U', action: t('help.keys.undo') },
    { keys: 'A', action: t('help.keys.autoComplete') },
    { keys: 'H', action: t('help.keys.hints') },
    { keys: 'Enter / Space', action: t('help.keys.autoMove') },
  ];

  const mouseControls = [
    t('help.mouse.autoMove'),
    t('help.mouse.dragDrop'),
    t('help.mouse.stock'),
    t('help.mouse.autoComplete'),
  ];

  return (
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('help.title')}
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
          {t('help.title')}
        </h2>
        <ModalCloseButton onClick={onClose} />

        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={scrollRef} className="modal-body-scroll" style={{ height: '100%' }}>
        <h3 style={subtitle}>{t('help.subtitleKeyboard')}</h3>
        <div style={{ marginBottom: 16 }}>
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

        <h3 style={subtitle}>{t('help.subtitleMouse')}</h3>
        <div>
          {mouseControls.map((text) => (
            <div key={text} style={{ ...row, justifyContent: 'flex-start' }}>
              <span style={{ fontSize: 14, flex: 1 }}>{text}</span>
            </div>
          ))}
        </div>
        </div>
        {showScrollUp && <button type="button" aria-label={t('help.scrollTop')} onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} style={{ ...scrollButton, top: 8 }}><ChevronUp size={18} strokeWidth={2.5} aria-hidden="true" /></button>}
        {showScrollDown && <button type="button" aria-label={t('help.scrollBottom')} onClick={() => { const element = scrollRef.current; element?.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }); }} style={{ ...scrollButton, bottom: 8 }}><ChevronDown size={18} strokeWidth={2.5} aria-hidden="true" /></button>}
        </div>
      </div>
    </div>
  );
}
