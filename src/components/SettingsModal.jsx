// components/SettingsModal.jsx
// Options/settings dialog holding the Theme, Deck, and Hand selectors that
// previously lived in the top toolbar. Mirrors the visual chrome (theme CSS
// variables, panel/backdrop styling, focus-on-open, Escape/backdrop-to-close)
// used by ConfirmModal.jsx / NewGameModal.jsx.

import { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import { isModalDismissGuardActive } from '../utils/modalDismissGuard.js';
import { useGameStore } from '../hooks/useGameStore.js';
import { deal } from '../core/dealer.js';
import { buildSolvitaireText } from '../core/solvitaire.js';
import { buildSnapshotText, snapshotModeToken } from '../core/snapshot.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { useStatisticsStore } from '../hooks/useStatisticsStore.js';
import { useSeedStore } from '../hooks/useSeedStore.js';
import ToggleSwitch from './ToggleSwitch.jsx';
import HelpModal from './HelpModal.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import AchievementsModal from './AchievementsModal.jsx';
import LeaderboardModal from './LeaderboardModal.jsx';
import StoreModal from './StoreModal.jsx';

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
  const dialogRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);
  const helpOpen = useUiStore((s) => s.helpDialogOpen);
  const displayName = useAuthStore((s) => s.displayName);
  const displayNameUpdatedAt = useAuthStore((s) => s.displayNameUpdatedAt);
  const isAnonymous = useAuthStore((s) => s.isAnonymous);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameError, setNameError] = useState(null);
  const [nameChecking, setNameChecking] = useState(false);
  const [nameAvailable, setNameAvailable] = useState(null);
  const nameCheckTimer = useRef(null);

  // useAuthStore can't refresh these itself (circular import) — do it here,
  // after it has reset local caches and re-established an anonymous session.
  const onConfirmSignOut = async () => {
    setSignOutConfirmOpen(false);
    await useAuthStore.getState().signOut();
    await useStatisticsStore.getState().init();
    await useSeedStore.getState().init();
  };

  // Keep the latest close handler in a ref so the open-effect can depend only on
  // `open` (running exactly once per open) instead of on the handler identity.
  // Previously the effect listed the handler in its deps, so an unstable
  // callback — e.g. re-created on every 250ms clock tick — would re-fire it and
  // steal focus from an open <select>, snapping the dropdown shut.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Cancel any in-flight debounced availability check if the modal unmounts.
  useEffect(() => () => {
    if (nameCheckTimer.current) clearTimeout(nameCheckTimer.current);
  }, []);

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

  // Open a sub-modal, but ignore the press if a just-dismissed modal's
  // synthesized mobile click happens to land on this button (the same guard the
  // toolbar FABs use) — otherwise dismissing a sub-modal via its backdrop would
  // instantly re-open it on touch.
  const openModalGuarded = (setter) => () => {
    if (isModalDismissGuardActive()) return;
    setter(true);
  };

  // Export the current visible board as a plain-text snapshot file.
  const openHelp = () => {
    if (isModalDismissGuardActive()) return;
    useUiStore.getState().setHelpDialogOpen(true);
  };

  // 3-20 chars: letters, numbers, underscores only. Mirrors the server-side
  // format check in rename_display_name so obviously-invalid input is rejected
  // client-side without a network round-trip.
  const NAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

  // 14-day rename cooldown (server-enforced); displayNameUpdatedAt is null
  // until the first rename, so no cooldown is shown before that.
  const cooldownUntil = displayNameUpdatedAt
    ? new Date(new Date(displayNameUpdatedAt).getTime() + 14 * 24 * 60 * 60 * 1000)
    : null;
  const onCooldown = cooldownUntil && cooldownUntil > new Date();

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

  // Export the START configuration of the current deal as a Solvitaire-format
  // file. Unlike "Take Snapshot" this always uses the initial deal (rebuilt from
  // the store's replaySpec) and exposes every card (no face-down placeholders).
  const handleExportSolvitaire = () => {
    const { replaySpec, state } = useGameStore.getState();
    const initial = deal({ ...replaySpec, drawCount: state.drawCount });
    const text = buildSolvitaireText(initial);
    const filename = `solvitaire_${snapshotModeToken(state)}_${formatTimestamp(new Date())}.txt`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    useUiStore.getState().setAnnounce('Solvitaire deal exported');
  };

  return (
    <>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Main Menu"
        tabIndex={-1}
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
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Main Menu</h2>

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

        <div style={{ ...field, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Account</div>
            {editingName ? (
              <div>
                <input
                  value={nameInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNameInput(v);
                    setNameAvailable(null);
                    if (!NAME_PATTERN.test(v)) {
                      setNameError('3-20 characters: letters, numbers, underscores only.');
                      return;
                    }
                    setNameError(null);
                    setNameChecking(true);
                    if (nameCheckTimer.current) clearTimeout(nameCheckTimer.current);
                    nameCheckTimer.current = setTimeout(() => {
                      useAuthStore
                        .getState()
                        .checkDisplayNameAvailable(v)
                        .then((available) => {
                          setNameChecking(false);
                          setNameAvailable(available);
                        })
                        .catch(() => setNameChecking(false));
                    }, 400);
                  }}
                  style={selectStyle}
                  maxLength={20}
                  autoFocus
                />
                {nameError && (
                  <div style={{ color: 'crimson', fontSize: 12 }}>{nameError}</div>
                )}
                {!nameError && nameAvailable === false && (
                  <div style={{ color: 'crimson', fontSize: 12 }}>That name is taken.</div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    style={btn}
                    disabled={
                      !!nameError ||
                      nameChecking ||
                      nameAvailable === false ||
                      nameInput === displayName
                    }
                    onClick={async () => {
                      try {
                        await useAuthStore.getState().renameDisplayName(nameInput);
                        setEditingName(false);
                      } catch (e) {
                        setNameError(e.message);
                      }
                    }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    style={btn}
                    onClick={() => setEditingName(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : isAnonymous ? (
              <div style={{ fontSize: 13, opacity: 0.8 }}>
                Playing as {displayName ?? '…'}
              </div>
            ) : onCooldown ? (
              <div style={{ fontSize: 13, opacity: 0.8 }}>
                Signed in as {displayName ?? '…'}
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  You can rename until {cooldownUntil.toLocaleDateString()}
                </div>
              </div>
            ) : (
              <button
                type="button"
                style={{
                  ...btn,
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  textDecoration: 'underline',
                }}
                onClick={() => {
                  setNameInput(displayName ?? '');
                  setNameError(null);
                  setNameAvailable(null);
                  setEditingName(true);
                }}
              >
                <span style={{ fontSize: 13, opacity: 0.8 }}>
                  Signed in as {displayName ?? '…'}
                </span>
              </button>
            )}
          </div>
          {isAnonymous && (
            <button
              type="button"
              style={btn}
              onClick={() => useAuthStore.getState().linkWithGoogle()}
            >
              Sign in with Google
            </button>
          )}
          {!isAnonymous && (
            <button
              type="button"
              style={btn}
              onClick={() => setSignOutConfirmOpen(true)}
            >
              Sign Out
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
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
          <button
            type="button"
            style={{ ...btn }}
            onClick={handleExportSolvitaire}
          >
            Export
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          <button
            type="button"
            style={{ ...btn, width: '100%' }}
            onClick={openModalGuarded(setAchievementsOpen)}
          >
            Achievements
          </button>
          <button
            type="button"
            style={{ ...btn, width: '100%' }}
            onClick={openModalGuarded(setLeaderboardOpen)}
          >
            Leaderboard
          </button>
          <button
            type="button"
            style={{ ...btn, width: '100%' }}
            onClick={openModalGuarded(setStoreOpen)}
          >
            Store
          </button>
        </div>

      </div>
    </div>

      <HelpModal
        open={helpOpen}
        onClose={() => useUiStore.getState().setHelpDialogOpen(false)}
      />

      <ConfirmModal
        open={signOutConfirmOpen}
        title="Sign out?"
        message="This device will continue as a new guest. Your Google account's progress is safe on Supabase and you can sign back in anytime."
        confirmText="Sign Out"
        cancelText="Cancel"
        onConfirm={onConfirmSignOut}
        onCancel={() => setSignOutConfirmOpen(false)}
      />

      <AchievementsModal
        open={achievementsOpen}
        onClose={() => setAchievementsOpen(false)}
      />

      <LeaderboardModal
        open={leaderboardOpen}
        onClose={() => setLeaderboardOpen(false)}
      />

      <StoreModal
        open={storeOpen}
        onClose={() => setStoreOpen(false)}
      />
    </>
  );
}
