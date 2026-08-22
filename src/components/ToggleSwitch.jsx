// components/ToggleSwitch.jsx
// Accessible on/off switch built from a <button role="switch">. Used in the
// Settings modal for boolean options (e.g. Highlight Card).

/**
 * @param {object} props
 * @param {boolean} props.checked
 * @param {(v: boolean) => void} props.onChange
 * @param {string} props.label  accessible label (also rendered as visible text by the caller)
 * @param {boolean} [props.disabled]
 */
export default function ToggleSwitch({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative',
        width: 44,
        height: 24,
        borderRadius: 999,
        border: '1px solid var(--ui-control-border)',
        background: checked ? 'var(--ui-modal-btn-bg-strong)' : 'var(--ui-control-bg)',
        cursor: disabled ? 'default' : 'pointer',
        padding: 0,
        transition: 'background 0.15s ease',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 22 : 2,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
          transition: 'left 0.15s ease',
        }}
      />
    </button>
  );
}
