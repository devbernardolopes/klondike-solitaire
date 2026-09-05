// components/modalBadge.js
//
// Shared geometry for overhanging modal badges (SettingsModal.jsx's NEW_BADGE_R,
// SpecialEventsModal.jsx's COMPLETED_BADGE). Both sit top-right of a button with
// a small negative lift so the badge straddles the button's top edge.
//
// Keep the lift here as the single source of truth: scroll containers that clip
// such badges derive their top clearance from OVERHANG_BADGE_LIFT instead of a
// magic padding number, so a future lift change can't leave a stale inset behind.
// Inset badges (AchievementsModal / ThemeModal NEW_BADGE with top:4, left:4)
// never overhang and intentionally do NOT use these tokens.

// Pixels the badge extends above its button (badge style uses top: -LIFT).
export const OVERHANG_BADGE_LIFT = 6;
export const OVERHANG_BADGE_RIGHT = 8;
// Extra breathing room so badge rounding/shadow never kisses the scrollport edge.
export const OVERHANG_BADGE_CLEARANCE = 2;
