// components/ModalCloseButton.jsx
// Shared top-right "X" close affordance used by every modal dialog. Rendered
// absolutely inside a `position: relative` panel so it always sits in the
// corner regardless of modal size.

import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * @param {object} props
 * @param {() => void} props.onClick
 * @param {string} [props.label]
 * @param {object} [props.style]  style overrides merged over the theme-driven chrome
 */
export default function ModalCloseButton({ onClick, label, style }) {
  const { t } = useTranslation();
  const displayLabel = label ?? t('common.close');
  return (
    <button
      type="button"
      aria-label={displayLabel}
      title={displayLabel}
      onClick={onClick}
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        width: 30,
        height: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        border: '1px solid var(--ui-modal-btn-border)',
        background: 'var(--ui-modal-btn-bg)',
        color: 'var(--ui-modal-fg)',
        cursor: 'pointer',
        padding: 0,
        zIndex: 1,
        ...style,
      }}
    >
      <X size={18} aria-hidden="true" />
    </button>
  );
}
