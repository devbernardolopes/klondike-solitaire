// utils/eventDealTitle.js
// Shared row-title rule for History + Favorites entries (and the Favorites
// play confirmation, which names the deal). An entry with a resolved event
// title renders as "<title>, Deal <N>" (deal number '…' when unknown —
// removed events, offline); everything else falls back to the localized
// deal-kind label, exactly as before.

/**
 * @param {object} entry  history/favorite entry ({ gameKind, eventTitle, eventDealNumber })
 * @param {(key: string, opts?: object) => string} t  i18n translate function
 * @returns {string} the row title
 */
export function eventDealTitle(entry, t) {
  if (entry?.eventTitle) {
    return t('history.eventDeal', {
      title: entry.eventTitle,
      dealNumber: entry.eventDealNumber ?? '…',
    });
  }
  return entry?.gameKind
    ? t(`history.kinds.${entry.gameKind}`, { defaultValue: entry.gameKind })
    : t('history.kinds.unknown');
}
