// components/AchievementDetailModal.jsx
// A dedicated detail view for a single achievement, launched on top of
// AchievementsModal. Shows the achievement image larger, its title,
// description, and the locked/unlocked status that was removed from the
// compact list rows. Stacks above Achievements (Z.GRANDCHILD) so Escape and
// outside-click dismiss only this modal and return to the still-open
// Achievements list. Shares the close-button / backdrop / escape chrome of the
// other modals.

import { useEffect, useRef } from 'react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { achievementImageUrl, onAchievementImageError } from '../utils/achievementImage.js';

/**
 * @param {object} props
 * @param {{ id: string, name: string, description: string, image_path?: string|null, earnedAt?: string|null }} props.achievement
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function AchievementDetailModal({ achievement, open, onClose }) {
  const dialogRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);

  useModalEscape({ open, onClose, id: 'achievement-detail', z: Z.GRANDCHILD });

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
  }, [open]);

  if (!open || !achievement) return null;

  const panel = {
    position: 'relative',
    background: 'var(--card-face-bg)',
    color: 'var(--card-text-black)',
    border: 'var(--card-border)',
    borderRadius: 'var(--card-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(90vw, 360px)',
    maxWidth: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  };

  const formatDate = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString();
  };

  const isUnlocked = Boolean(achievement.earnedAt);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={achievement.name}
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
        zIndex: Z.GRANDCHILD,
        padding: 16,
      }}
    >
      <div style={panel}>
        <ModalCloseButton onClick={onClose} />
        <img
          src={achievementImageUrl(achievement.image_path)}
          alt=""
          onError={onAchievementImageError}
          style={{
            width: 96,
            height: 96,
            borderRadius: 10,
            objectFit: 'cover',
            marginBottom: 14,
          }}
        />
        <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>{achievement.name}</h2>
        <div style={{ fontSize: 14, lineHeight: 1.4, marginBottom: 14 }}>{achievement.description}</div>
        <div style={{ fontSize: 13, fontStyle: isUnlocked ? 'normal' : 'italic' }}>
          {isUnlocked ? `Unlocked ${formatDate(achievement.earnedAt)}` : 'Locked'}
        </div>
      </div>
    </div>
  );
}
