// utils/formatHistoryDate.js
// Unambiguous calendar date shared by the History list/detail views and the
// Special Events modal: day-first with the month spelled out
// ("2 February 2026") in the player's language, so day/month can never be
// confused as in numeric formats like 2026-02-02. Mirrors
// SpecialEventsModal.jsx's formatEventDate and AchievementDetailModal.jsx.

/**
 * @param {string|null|undefined} iso  ISO date string
 * @param {string} [lang]  BCP-47 language tag (defaults to 'en')
 * @returns {string|null}  formatted date, or null when unparseable/empty
 */
export function formatHistoryDate(iso, lang = 'en') {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(lang || 'en', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return null;
  }
}
