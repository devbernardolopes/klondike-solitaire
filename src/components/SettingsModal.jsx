// components/SettingsModal.jsx
// Options/settings dialog holding the Theme, Deck, and Hand selectors that
// previously lived in the top toolbar. Mirrors the visual chrome (theme CSS
// variables, panel/backdrop styling, focus-on-open, Escape/backdrop-to-close)
// used by ConfirmModal.jsx / NewGameModal.jsx.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { useStatisticsStore } from '../hooks/useStatisticsStore.js';
import { useSeedStore } from '../hooks/useSeedStore.js';
import ToggleSwitch from './ToggleSwitch.jsx';
import ModalCloseButton from './ModalCloseButton.jsx';
import { OVERHANG_BADGE_LIFT, OVERHANG_BADGE_RIGHT } from './modalBadge.js';
import SyncStatus from './SyncStatus.jsx';
import HelpModal from './HelpModal.jsx';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ConfirmModal from './ConfirmModal.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { fetchStoreCatalog } from '../data/storeCatalog.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';
import { useAchievementEventsStore } from '../hooks/useAchievementEventsStore.js';
import ThemeModal from './ThemeModal.jsx';
import AchievementsModal from './AchievementsModal.jsx';
import LeaderboardModal from './LeaderboardModal.jsx';
import StoreModal from './StoreModal.jsx';
import SettingsOptionsModal from './SettingsOptionsModal.jsx';
import StatisticsModal from './StatisticsModal.jsx';
import AdvancedModal from './AdvancedModal.jsx';
import pkg from '../../package.json';

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
 * @param {boolean} props.bootstrapReady  startup session restoration completed
 */
export default function SettingsModal({
  open,
  onClose,
  handedness,
  onHandednessChange,
  highlightCard,
  onHighlightCardChange,
  particles,
  onParticlesChange,
  bootstrapReady,
}) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);
  const helpOpen = useUiStore((s) => s.helpDialogOpen);
  const displayName = useAuthStore((s) => s.displayName);
  const displayNameUpdatedAt = useAuthStore((s) => s.displayNameUpdatedAt);
  const isAnonymous = useAuthStore((s) => s.isAnonymous);
  const profileReady = useAuthStore((s) => s.profileReady);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [settingsOptionsOpen, setSettingsOptionsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameError, setNameError] = useState(null);
  const [nameChecking, setNameChecking] = useState(false);
  const [nameAvailable, setNameAvailable] = useState(null);
  const nameCheckTimer = useRef(null);
  const seenThemeItemIds = useSettingsStore((s) => s.seenThemeItemIds);
  const seenAchievementIds = useSettingsStore((s) => s.seenAchievementIds);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const achievementRevision = useAchievementEventsStore((s) => s.revision);
  const ownedItemIds = useAuthStore((s) => s.ownedItemIds);
  const [hasNewTheme, setHasNewTheme] = useState(false);
  const [hasNewAchievements, setHasNewAchievements] = useState(false);
  const badgeDataReady = bootstrapReady && settingsLoaded && profileReady;

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
  useModalEscape({ open, onClose, id: 'settings', z: Z.BASE });

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
  }, [open]);

  // SettingsModal stays mounted (returns null when closed) so its local sub-modal
  // flags (Theme / Achievements / Leaderboard / Store / Stats / Advanced)
  // persist across open/close.
  // Clear them whenever the Main Menu is dismissed so reopening it never
  // resurfaces a stale child modal.
  useEffect(() => {
    if (!open) {
      setThemeOpen(false);
      setSettingsOptionsOpen(false);
      setStatsOpen(false);
      setAdvancedOpen(false);
      setAchievementsOpen(false);
      setLeaderboardOpen(false);
      setStoreOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !badgeDataReady) {
      setHasNewTheme(false);
      return;
    }
    let cancelled = false;
    fetchStoreCatalog()
      .then((data) => {
        if (cancelled) return;
        const themeIds = data.filter((it) => it.kind === 'card_back' || it.kind === 'table_felt' || it.kind === 'deck').map((it) => it.id);
        setHasNewTheme(ownedItemIds.some((id) => themeIds.includes(id) && !seenThemeItemIds.has(id)));
      })
      .catch(() => {
        if (!cancelled) setHasNewTheme(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, badgeDataReady, ownedItemIds, seenThemeItemIds]);

  useEffect(() => {
    if (!open || !badgeDataReady) {
      setHasNewAchievements(false);
      return;
    }
    if (!supabase) {
      setHasNewAchievements(false);
      return;
    }
    let cancelled = false;
    supabase
      .from('achievements_unlocked')
      .select('achievement_id')
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const fresh = (data ?? []).some((r) => !seenAchievementIds.has(r.achievement_id));
        setHasNewAchievements(fresh);
      })
      .catch(() => {
        if (!cancelled) setHasNewAchievements(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, badgeDataReady, seenAchievementIds, achievementRevision]);

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
    position: 'relative',
    background: 'var(--ui-modal-panel-bg)',
    color: 'var(--ui-modal-panel-fg)',
    border: 'var(--ui-modal-panel-border)',
    borderRadius: 'var(--ui-modal-panel-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(90vw, 420px)',
    maxWidth: '100%',
  };

  const NEW_BADGE_R = {
    position: 'absolute',
    top: -OVERHANG_BADGE_LIFT,
    right: OVERHANG_BADGE_RIGHT,
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
    color: '#fff',
    background: 'var(--card-text-red, #d12b3b)',
    borderRadius: 4,
    padding: '2px 5px',
    pointerEvents: 'none',
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

  return (
    <>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('mainMenu.title')}
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
        <h2
          style={{
            margin: '0 0 16px',
            fontSize: 18,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingRight: 36,
          }}
        >
          {t('mainMenu.title')}
          <span style={{ color: 'var(--ui-modal-panel-fg)', fontSize: 13, fontWeight: 400, userSelect: 'none', marginRight: 36 }}>
            v{pkg.version}
          </span>
        </h2>
        <ModalCloseButton onClick={onClose} />

        <div className="modal-body-scroll" style={{ flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            <button
              type="button"
              style={{ ...btn, width: '100%' }}
              onClick={() => setSettingsOptionsOpen(true)}
            >
              {t('mainMenu.settings')}
            </button>
            <button
              type="button"
              style={{ ...btn, width: '100%', position: 'relative' }}
              onClick={() => setThemeOpen(true)}
            >
              {t('mainMenu.theme')}
              {badgeDataReady && hasNewTheme && <span style={NEW_BADGE_R}>{t('common.new')}</span>}
            </button>
            <button
              type="button"
              style={{ ...btn, width: '100%' }}
              onClick={() => setStatsOpen(true)}
            >
              {t('mainMenu.statistics')}
            </button>
            <button
              type="button"
              style={{ ...btn, width: '100%', position: 'relative' }}
              onClick={() => setAchievementsOpen(true)}
            >
              {t('mainMenu.achievements')}
              {badgeDataReady && hasNewAchievements && <span style={NEW_BADGE_R}>{t('common.new')}</span>}
            </button>
            <button
              type="button"
              style={{ ...btn, width: '100%' }}
              onClick={() => setLeaderboardOpen(true)}
            >
              {t('mainMenu.leaderboard')}
            </button>
            <button
              type="button"
              style={{ ...btn, width: '100%' }}
              onClick={() => setStoreOpen(true)}
            >
              {t('mainMenu.store')}
            </button>
            <button
              type="button"
              style={{ ...btn, width: '100%' }}
              onClick={() => setAdvancedOpen(true)}
            >
              {t('mainMenu.advanced')}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <button
              type="button"
              aria-label={t('mainMenu.help')}
              title={t('mainMenu.help')}
              style={{
                ...btn,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '8px 10px',
              }}
              onClick={() => useUiStore.getState().setHelpDialogOpen(true)}
            >
              <HelpCircle size={18} aria-hidden="true" />
            </button>
          </div>

          <div style={{ ...field, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t('mainMenu.account')}</div>
              {editingName ? (
                <div>
                  <input
                    value={nameInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      setNameInput(v);
                      setNameAvailable(null);
                      if (!NAME_PATTERN.test(v)) {
                        setNameError(t('mainMenu.rename.validation'));
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
                    <div style={{ color: 'crimson', fontSize: 12 }}>{t('mainMenu.rename.taken')}</div>
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
                      {t('common.save')}
                    </button>
                    <button
                      type="button"
                      style={btn}
                      onClick={() => setEditingName(false)}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              ) : isAnonymous ? (
                <div style={{ fontSize: 13, opacity: 0.8 }}>
                  {t('mainMenu.playingAs', {name: displayName ?? '…'})}
                </div>
              ) : onCooldown ? (
                <div style={{ fontSize: 13, opacity: 0.8 }}>
                  {t('mainMenu.signedInAs', {name: displayName ?? '…'})}
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {t('mainMenu.rename.cooldown', {date: cooldownUntil.toLocaleDateString()})}
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
                    {t('mainMenu.signedInAs', {name: displayName ?? '…'})}
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
                {t('mainMenu.signInGoogle')}
              </button>
            )}
            {!isAnonymous && (
              <button
                type="button"
                style={btn}
                onClick={() => setSignOutConfirmOpen(true)}
              >
                {t('mainMenu.signOut')}
              </button>
            )}
            <SyncStatus />
          </div>
        </div>
      </div>
    </div>

      <HelpModal
        open={helpOpen}
        onClose={() => useUiStore.getState().setHelpDialogOpen(false)}
      />

      <ConfirmModal
        open={signOutConfirmOpen}
        title={t('mainMenu.signOutConfirm.title')}
        message={t('mainMenu.signOutConfirm.message')}
        confirmText={t('mainMenu.signOut')}
        cancelText={t('common.cancel')}
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

      <ThemeModal
        open={themeOpen}
        onClose={() => setThemeOpen(false)}
      />

      <SettingsOptionsModal
        open={settingsOptionsOpen}
        onClose={() => setSettingsOptionsOpen(false)}
        handedness={handedness}
        onHandednessChange={onHandednessChange}
        highlightCard={highlightCard}
        onHighlightCardChange={onHighlightCardChange}
        particles={particles}
        onParticlesChange={onParticlesChange}
      />

      <StatisticsModal
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
      />

      <AdvancedModal
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
      />
    </>
  );
}
