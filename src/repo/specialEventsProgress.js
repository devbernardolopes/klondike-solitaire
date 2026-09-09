export function recomputeUnlocks(detail) {
  if (!detail || !Array.isArray(detail.pages)) return detail;
  let prevCompleted = true;
  for (const p of detail.pages) {
    const allSolved = p.deals.length > 0 && p.deals.every((d) => d.solved);
    const completed = p.completed || allSolved;
    const unlocked = prevCompleted;
    p.completed = completed;
    p.unlocked = unlocked;
    prevCompleted = completed;
  }
  return detail;
}

export function applyOptimisticSolve(detail, dealId) {
  if (!detail || dealId == null) return detail;
  let patched = false;
  for (const p of detail.pages) {
    for (const d of p.deals) {
      if (d.id === dealId && !d.solved) {
        d.solved = true;
        patched = true;
      }
    }
  }
  if (patched) recomputeUnlocks(detail);
  return detail;
}

export function cloneDetail(detail) {
  if (!detail) return detail;
  return {
    ...detail,
    pages: detail.pages.map((p) => ({
      ...p,
      deals: p.deals.map((d) => ({ ...d })),
    })),
  };
}

export function collectSolvedIds(detail) {
  const ids = new Set();
  if (!detail || !Array.isArray(detail.pages)) return ids;
  for (const p of detail.pages) {
    for (const d of p.deals || []) {
      if (d.solved) ids.add(d.id);
    }
  }
  return ids;
}

export function mergeSolvedIds(detail, solvedIds) {
  if (!detail || !solvedIds || solvedIds.size === 0) return detail;
  let patched = false;
  for (const p of detail.pages) {
    for (const d of p.deals || []) {
      if (!d.solved && solvedIds.has(d.id)) {
        d.solved = true;
        patched = true;
      }
    }
  }
  if (patched) recomputeUnlocks(detail);
  return detail;
}

/**
 * One-way latch for covered deals: restore `solved=true` from the previous
 * detail for deals in `coverIds` that a fresh fetch reports unsolved. A
 * covered-but-unconfirmed win (still pending locally or still queued) must
 * survive any single stale server read; only an uncovering fetch (server
 * confirmed elsewhere, queue drained, pending pruned — e.g. a rejected win
 * after revertOptimisticSolve) may show it unsolved. Never strips.
 */
export function keepCoveredSolves(prev, fresh, coverIds) {
  if (!prev || !fresh || !coverIds || coverIds.size === 0) return fresh;
  const prevSolved = collectSolvedIds(prev);
  let patched = false;
  for (const p of fresh.pages || []) {
    for (const d of p.deals || []) {
      if (!d.solved && coverIds.has(d.id) && prevSolved.has(d.id)) {
        d.solved = true;
        patched = true;
      }
    }
  }
  if (patched) {
    recomputeUnlocks(fresh);
    try {
      if (typeof console !== 'undefined' && console.debug) console.debug('[events] kept covered deal solved over stale fetch');
    } catch {}
  }
  return fresh;
}

/**
 * Did THIS win complete its event page? Inspects the PRE-win detail snapshot:
 * true when the won deal is still unsolved there, every other deal on its
 * page is already solved, and the page carries a coin reward. Callers must
 * read the snapshot before patching the cache (same spot as the replay
 * check) and additionally gate on `!eventDealReplayed`. Pure and testable.
 * @returns {{completed:boolean, coinReward:number}}
 */
export function didWinCompleteEventPage(detail, dealId) {
  const none = { completed: false, coinReward: 0 };
  if (!detail || !Array.isArray(detail.pages) || dealId == null) return none;
  const page = detail.pages.find((p) => (p.deals || []).some((d) => d.id === dealId));
  if (!page) return none;
  const deals = page.deals || [];
  const won = deals.find((d) => d.id === dealId);
  if (!won || won.solved) return none;
  const othersSolved = deals.every((d) => d.id === dealId || d.solved);
  if (!othersSolved) return none;
  const coinReward = Number(page.coinReward) || 0;
  if (coinReward <= 0) return none;
  return { completed: true, coinReward };
}

/**
 * Resolve the pinned last-played event for the Special Events list. The pin
 * is looked up in the UNFILTERED events so it is immune to sort order and
 * filters, and it is excluded from the rest so it never renders twice. Only
 * one event is ever pinned; a missing/removed event (or none played yet, or
 * the toggle off) pins nothing.
 * @returns {{pinnedEvent:object|null, restVisible:Array}}
 */
export function resolvePinnedEvent(events, visibleEvents, { pinEnabled, lastPlayedEventId } = {}) {
  const pinned = pinEnabled && lastPlayedEventId != null
    ? (events || []).find((ev) => String(ev?.id) === String(lastPlayedEventId)) ?? null
    : null;
  const rest = pinned
    ? (visibleEvents || []).filter((ev) => String(ev?.id) !== String(pinned.id))
    : (visibleEvents || []);
  return { pinnedEvent: pinned, restVisible: rest };
}

/**
 * Next unsolved deal for the post-win selector, staying on the won deal's
 * page: scan forward (increasing deal number) from the won deal, then wrap
 * around to the page's first deal and keep seeking. Returns null when the
 * page has no other unsolved deal (fully solved, or the won deal is
 * unknown) — callers then leave the selector on the just-won deal. Never
 * crosses pages, so the event modal can never change pages by itself.
 */
export function findNextUnsolvedDealOnPage(detail, wonDealId) {
  if (!detail || !Array.isArray(detail.pages) || wonDealId == null) return null;
  const page = detail.pages.find((p) => (p.deals || []).some((d) => d.id === wonDealId));
  if (!page) return null;
  const ordered = (page.deals || []).slice().sort(
    (a, b) => (a.dealNumber ?? a.position ?? 0) - (b.dealNumber ?? b.position ?? 0),
  );
  const wonIdx = ordered.findIndex((d) => d.id === wonDealId);
  if (wonIdx < 0) return null;
  for (let k = 1; k < ordered.length; k++) {
    const deal = ordered[(wonIdx + k) % ordered.length];
    if (!deal.solved) return { deal, pageNumber: page.pageNumber };
  }
  return null;
}

/**
 * Deal-level progress for an event detail: total deals across all pages and
 * how many are solved, plus the solved share as a whole percent (rounded).
 * `percent` is null when the event has no deals (avoids division by zero;
 * callers show no badge in that case).
 */
export function getEventDealProgress(detail) {
  let totalDeals = 0;
  let solvedDeals = 0;
  if (detail && Array.isArray(detail.pages)) {
    for (const p of detail.pages) {
      for (const d of p.deals || []) {
        totalDeals += 1;
        if (d.solved) solvedDeals += 1;
      }
    }
  }
  return {
    totalDeals,
    solvedDeals,
    percent: totalDeals > 0 ? Math.round((solvedDeals / totalDeals) * 100) : null,
  };
}
