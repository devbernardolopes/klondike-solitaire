import { supabase } from '../lib/supabaseClient.js';
import { db } from '../db/schema.js';
import { saveCatalogDetail, getCatalogDetail, deleteCatalogDetail, deleteImageBlob } from '../db/eventCache.js';
import { ensureImageCached, warmImageCache } from '../utils/eventImageCache.js';
import { collectSolvedIds, mergeSolvedIds, getEventDealProgress } from './specialEventsProgress.js';
import { listQueuedOps } from '../db/syncQueue.js';
import { maybeApplyRemoteReset } from '../sync/factoryReset.js';

const catalogMemory = new Map();

/**
 * Extract an event deal id from a queued sync op only when it represents a
 * WIN. Losses also enqueue submit_game_result with p_event_deal_id (for
 * analytics) but must never count as solved — a Game Over freeze is not a
 * solve and must not expose the image slice.
 * @param {object} op queued syncQueue row
 * @returns {number|null} the won deal id, or null
 */
export function wonEventDealIdFromQueuedOp(op) {
  if (op?.type !== 'submit_game_result' || op?.payload?.p_won !== true) return null;
  const dealId = op?.payload?.p_event_deal_id;
  return dealId ?? null;
}

/**
 * Deal ids this device has locally witnessed as WON (via
 * patchCachedEventDealSolved) but the server hasn't confirmed yet. Wins stay
 * trusted across background refetches — including non-optimistic ones like
 * kickOffCatalogSync and the post-flush window where the queued op is gone
 * but event_deal_progress isn't readable yet — so a freshly revealed image
 * slice can't be hidden again by stale server truth. Losses never enter this
 * set (recordLoss doesn't patch the cache), so the Game Over freeze path
 * stays unsolved. Entries are pruned once the server confirms them, or
 * dropped by revertOptimisticSolve / clearEventCatalogMemory.
 */
const pendingWonDealIds = new Set();

/** Copy of locally witnessed not-yet-server-confirmed won deal ids. */
export function getPendingWonDealIds() {
  return Array.from(pendingWonDealIds);
}

/** Won event deal ids still sitting in the offline outbox (unflushed wins). */
async function listWonQueuedDealIds() {
  const ids = new Set();
  try {
    const queued = await listQueuedOps();
    for (const op of queued) {
      const dealId = wonEventDealIdFromQueuedOp(op);
      if (dealId != null) ids.add(dealId);
    }
  } catch {}
  return ids;
}

/**
 * Offline/error merge for a stale cached detail: trust the row as-is (it
 * already reflects the last converged sync) and union locally witnessed wins
 * (in-memory solved flags, still-queued wins, pending wins, explicit
 * optimistic ids). Never strips — with no server truth, convergence must
 * wait for the next online fetch.
 */
export function applyWinPreservingMerge(cached, { wonQueuedIds = [], optimisticDealIds = [] } = {}) {
  if (!cached) return cached;
  if (Array.isArray(cached.pages)) assignDealNumbers(cached.pages);
  const prev = catalogMemory.get(cached.id);
  if (prev) {
    mergeSolvedIds(cached, collectSolvedIds(prev));
  }
  mergeSolvedIds(cached, new Set([...wonQueuedIds, ...pendingWonDealIds, ...optimisticDealIds]));
  return cached;
}

/**
 * Pure merge for the solved-id gate: cached ids are only trusted when
 * verifiable (server, won queue, explicit optimistic list, or a locally
 * witnessed pending win). Wins passed explicitly or witnessed locally always
 * survive, even when the server lags the flush.
 */
export function computeKnownSolved({ serverIds = [], wonQueuedIds = [], optimisticDealIds = [], pendingWonIds = [], cachedIds = [] } = {}) {
  const known = new Set([...optimisticDealIds, ...wonQueuedIds, ...pendingWonIds]);
  const verifiable = new Set([...serverIds, ...wonQueuedIds, ...optimisticDealIds, ...pendingWonIds]);
  for (const id of cachedIds) {
    if (verifiable.has(id)) known.add(id);
  }
  return known;
}

export function getCachedEventDetailSync(eventId) {
  return catalogMemory.get(eventId) ?? null;
}

export function setCachedEventDetailSync(detail) {
  if (!detail || !detail.id) return;
  catalogMemory.set(detail.id, detail);
}

/** Drop every in-memory cached event detail (factory-reset cross-device wipe). */
export function clearEventCatalogMemory() {
  catalogMemory.clear();
  pendingWonDealIds.clear();
}

/**
 * Reverse an optimistic solve: mark the deal unsolved in the in-memory
 * catalog and the persisted Dexie rows, then recompute the (sticky) page
 * states. Used when the server rejects an over-limit win. Page `completed`
 * stays sticky-true by design (same semantics as the optimistic path); the
 * next fetchEventDetail converges fully to server truth. Dispatches
 * `event-detail-optimistic` so open UI refreshes.
 * @param {number} dealId
 */
export function revertOptimisticSolve(dealId) {
  if (dealId == null) return;
  const unset = (detail) => {
    if (!detail || !Array.isArray(detail.pages)) return false;
    let touched = false;
    for (const p of detail.pages) {
      for (const d of p.deals || []) {
        if (d.id === dealId && d.solved) {
          d.solved = false;
          touched = true;
        }
      }
    }
    if (!touched) return false;
    let prevCompleted = true;
    for (const p of detail.pages) {
      const allSolved = p.deals.length > 0 && p.deals.every((d) => d.solved);
      p.completed = p.completed || allSolved;
      p.unlocked = prevCompleted;
      prevCompleted = p.completed;
    }
    return true;
  };
  for (const [, detail] of catalogMemory) {
    unset(detail);
  }
  pendingWonDealIds.delete(dealId);
  (async () => {
    try {
      const rows = await db.eventCatalogCache.toArray();
      for (const row of rows) {
        if (!row.detail || !Array.isArray(row.detail.pages)) continue;
        const hasDeal = row.detail.pages.some((p) => (p.deals || []).some((d) => d.id === dealId));
        if (!hasDeal) continue;
        const cloned = {
          ...row.detail,
          pages: row.detail.pages.map((p) => ({
            ...p,
            deals: (p.deals || []).map((d) => ({ ...d })),
          })),
        };
        if (!unset(cloned)) continue;
        await db.eventCatalogCache.put({ eventId: cloned.id, detail: cloned, updatedAt: Date.now() });
        try {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('event-detail-optimistic', { detail: { eventId: cloned.id, dealId } }));
          }
        } catch {}
      }
    } catch {}
  })();
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('event-detail-optimistic', { detail: { dealId } }));
    }
  } catch {}
}

export function patchCachedEventDealSolved(dealId) {
  if (dealId == null) return null;
  // Locally witnessed win: keep trusting it across background refetches until
  // the server confirms it (pruned in fetchEventDetail).
  pendingWonDealIds.add(dealId);
  let patchedId = null;
  for (const [key, detail] of catalogMemory) {
    if (!detail || !Array.isArray(detail.pages)) continue;
    const hasDeal = detail.pages.some((p) => (p.deals || []).some((d) => d.id === dealId));
    if (!hasDeal) continue;
    let touched = false;
    const next = {
      ...detail,
      pages: detail.pages.map((p) => ({
        ...p,
        deals: (p.deals || []).map((d) => {
          if (d.id === dealId && !d.solved) {
            touched = true;
            return { ...d, solved: true };
          }
          return d;
        }),
      })),
    };
    if (!touched) {
      patchedId = key;
      continue;
    }
    let prevCompleted = true;
    for (const p of next.pages) {
      const allSolved = p.deals.length > 0 && p.deals.every((d) => d.solved);
      const completed = p.completed || allSolved;
      const unlocked = prevCompleted;
      p.completed = completed;
      p.unlocked = unlocked;
      prevCompleted = completed;
    }
    catalogMemory.set(key, next);
    patchedId = key;
  }
  return patchedId;
}

// UTC calendar year of an event's start date (null when missing or
// unparseable). Drives the Special Events list's year filter toggles;
// rows with unknown year always pass the year filter.
export function eventStartYear(startsAt) {
  const t = startsAt ? Date.parse(startsAt) : NaN;
  if (!Number.isFinite(t)) return null;
  return new Date(t).getUTCFullYear();
}

// A teaser is an event whose start date is still in the future. RLS only
// ever exposes teasers starting within 7 days (migration 031), while pages
// and deals stay hidden until `starts_at` passes — so this flag doubles as
// the list's disabled state.
export function isUpcomingEvent(startsAt, nowMs = Date.now()) {
  const t = startsAt ? Date.parse(startsAt) : NaN;
  return Number.isFinite(t) && t > nowMs;
}

// List order: earliest `startsAt` first (sort_order stays in the DB but no
// longer drives display). Same-date ties resolve alphabetically by title,
// then by id for full determinism. Missing/unparseable dates sink last
// (legacy cache rows predate the field).
export function compareEventSummaries(a, b) {
  const aTime = a.startsAt ? Date.parse(a.startsAt) : NaN;
  const bTime = b.startsAt ? Date.parse(b.startsAt) : NaN;
  const aKnown = Number.isFinite(aTime);
  const bKnown = Number.isFinite(bTime);
  if (aKnown && bKnown && aTime !== bTime) return aTime - bTime;
  if (aKnown !== bKnown) return aKnown ? -1 : 1;
  const byTitle = String(a.title ?? '').localeCompare(String(b.title ?? ''));
  return byTitle !== 0 ? byTitle : String(a.id).localeCompare(String(b.id));
}

export function getCachedEventsSummarySync() {
  if (catalogMemory.size === 0) return null;
  const list = Array.from(catalogMemory.values()).map(summaryFromDetail);
  return list.length ? list.sort(compareEventSummaries) : null;
}

export async function hydrateEventCachesFromDexie() {
  try {
    const rows = await db.eventCatalogCache.toArray();
    for (const r of rows) {
      if (r.detail && r.eventId) {
        if (Array.isArray(r.detail.pages)) assignDealNumbers(r.detail.pages);
        catalogMemory.set(r.eventId, r.detail);
      }
    }
  } catch {}
  try {
    await warmImageCache();
  } catch {}
}

export function resolveInitialPageIndex(detail, lastViewedPage) {
  if (!detail || !detail.pages || detail.pages.length === 0) return 0;
  const lastPageIdx = lastViewedPage != null
    ? detail.pages.findIndex((p) => p.pageNumber === lastViewedPage && p.unlocked)
    : -1;
  const heuristicIdx = detail.pages.findIndex((p) => p.unlocked && !p.completed);
  if (lastPageIdx >= 0) return lastPageIdx;
  if (heuristicIdx >= 0) return heuristicIdx;
  return detail.pages.length - 1;
}

export function detailsDiffer(a, b) {
  if (!a || !b) return true;
  if (a.pages.length !== b.pages.length) return true;
  for (let i = 0; i < a.pages.length; i++) {
    const pa = a.pages[i];
    const pb = b.pages[i];
    if (pa.id !== pb.id || pa.completed !== pb.completed || pa.unlocked !== pb.unlocked || pa.deals.length !== pb.deals.length) return true;
    for (let j = 0; j < pa.deals.length; j++) {
      if (pa.deals[j].id !== pb.deals[j].id || pa.deals[j].solved !== pb.deals[j].solved) return true;
      if ((pa.deals[j].dealNumber ?? null) !== (pb.deals[j].dealNumber ?? null)) return true;
    }
  }
  return false;
}

/**
 * Fill in event-sequential Deal N for pages whose deals lack it (rows written
 * before migration 029, or Dexie-cached details saved before this release).
 * Pages are already page_number-ordered; within a page, position order is the
 * grid order. Page 1 with 4 deals owns 1-4, so page 2 starts at 5.
 * Existing deal_number values are never overwritten — only nulls are derived.
 * @param {Array} pagesWithState
 */
export function assignDealNumbers(pagesWithState) {
  if (!Array.isArray(pagesWithState)) return pagesWithState;
  let n = 0;
  for (const p of pagesWithState) {
    const deals = (p.deals || []).slice().sort((a, b) => a.position - b.position);
    for (const d of deals) {
      n += 1;
      if (d.dealNumber == null) d.dealNumber = n;
    }
    // Reconcile the counter with stored numbers (a page's stored numbers win
    // if they run ahead, e.g. a partially-backfilled event).
    const maxStored = deals.reduce((m, d) => Math.max(m, Number(d.dealNumber) || 0), 0);
    if (maxStored > n) n = maxStored;
    p.deals = deals;
  }
  return pagesWithState;
}

function summaryFromDetail(detail) {
  const totalPages = detail.pages.length;
  const completedPages = detail.pages.filter((p) => p.completed).length;
  const { totalDeals, solvedDeals } = getEventDealProgress(detail);
  const totalCoins = detail.pages.reduce((sum, p) => sum + (Number(p.coinReward) || 0), 0);
  return {
    id: detail.id,
    title: detail.title,
    description: detail.description,
    gameKind: detail.gameKind,
    sortOrder: detail.sortOrder ?? null,
    startsAt: detail.startsAt ?? null,
    isUpcoming: isUpcomingEvent(detail.startsAt),
    totalPages,
    completedPages,
    fullyCompleted: totalPages > 0 && completedPages >= totalPages,
    totalDeals,
    solvedDeals,
    totalCoins,
  };
}

async function buildSummaryFromCache() {
  try {
    const rows = await db.eventCatalogCache.toArray();
    if (!rows.length) return [];
    return rows
      .map((r) => r.detail)
      .filter(Boolean)
      .map(summaryFromDetail)
      .sort(compareEventSummaries);
  } catch {
    return [];
  }
}

async function evictEvent(eventId) {
  const stale = catalogMemory.get(eventId);
  catalogMemory.delete(eventId);
  await deleteCatalogDetail(eventId).catch(() => {});
  if (stale?.pages) {
    for (const p of stale.pages) {
      if (p.imagePath) await deleteImageBlob(p.imagePath).catch(() => {});
    }
  }
}

function kickOffCatalogSync(eventIds) {
  if (!eventIds || eventIds.length === 0) return;
  const concurrency = 3;
  let idx = 0;
  const runNext = async () => {
    while (idx < eventIds.length) {
      const id = eventIds[idx++];
      try {
        await fetchEventDetail(id);
      } catch {}
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, eventIds.length) }, () => runNext());
  Promise.all(workers).catch(() => {});
}

/**
 * All currently-visible events with page-level progress folded in.
 * Deal-level progress (total/solved deal counts for the list's percentage
 * badge) IS fetched here — two extra scoped queries — so the percentage
 * syncs across devices through the same server read as the Completed badge.
 * Queued-but-unflushed local wins are merged in as solved so this device
 * shows the new percentage instantly, before the sync flush lands.
 * Returns [] on any failure (offline, RLS denial, etc.)
 * rather than throwing, so the modal can always render its empty state.
 * @returns {Promise<Array<{id:string, title:string, description:string|null,
 *   gameKind:string, sortOrder:number|null, startsAt:string|null,
 *   isUpcoming:boolean,
 *   totalPages:number, completedPages:number, fullyCompleted:boolean,
 *   totalDeals:number, solvedDeals:number, totalCoins:number}>>}
 */
export async function fetchSpecialEvents() {
  if (!supabase) {
    return buildSummaryFromCache();
  }

  try {
    // A Factory Reset on another device of this account wipes the server;
    // self-wipe first so stale local caches can't paint over remote truth.
    await maybeApplyRemoteReset().catch(() => false);
    const [{ data: events, error: eventsErr }, { data: pages, error: pagesErr }, { data: progress, error: progressErr }] = await Promise.all([
      supabase.from('special_events').select('id, title, description, game_kind, sort_order, starts_at').order('starts_at').order('title'),
      supabase.from('special_event_pages').select('id, event_id, coin_reward').order('page_number'),
      supabase.from('event_page_progress').select('page_id'),
    ]);
    if (eventsErr) throw eventsErr;
    if (!events || events.length === 0) {
      for (const staleId of Array.from(catalogMemory.keys())) {
        await evictEvent(staleId);
      }
      return [];
    }

    const pageRows = pagesErr ? [] : pages || [];
    const completedPageIds = new Set((progressErr ? [] : progress || []).map((r) => r.page_id));

    // Deal-level progress for the percentage badge. Scoped to the visible
    // events' pages; missing/denied rows degrade to zero counts (no badge).
    const dealsByPage = new Map(); // page_id -> deal id[]
    const solvedDealIds = new Set();
    if (pageRows.length > 0) {
      try {
        const allPageIds = pageRows.map((p) => p.id);
        const { data: deals, error: dealsErr } = await supabase
          .from('special_event_deals')
          .select('id, page_id')
          .in('page_id', allPageIds);
        const dealRows = dealsErr ? [] : deals || [];
        for (const d of dealRows) {
          const list = dealsByPage.get(d.page_id) || [];
          list.push(d.id);
          dealsByPage.set(d.page_id, list);
        }
        if (dealRows.length > 0) {
          const { data: dealProgress, error: dealProgressErr } = await supabase
            .from('event_deal_progress')
            .select('deal_id')
            .in('deal_id', dealRows.map((d) => d.id));
          for (const r of dealProgressErr ? [] : dealProgress || []) solvedDealIds.add(r.deal_id);
        }
        // Wins queued on this device but not yet flushed still count as solved
        // here, so the badge updates instantly instead of waiting for sync.
        // Locally witnessed wins stay counted through the post-flush window
        // where the queued op is gone but the server row isn't readable yet.
        // Losses also enqueue submit_game_result (p_won:false, with event id
        // for analytics) but must never count as solved.
        for (const id of await listWonQueuedDealIds()) solvedDealIds.add(id);
        for (const id of pendingWonDealIds) solvedDealIds.add(id);
      } catch {}
    }

    const result = events
      .map((e) => {
        const eventPages = pageRows.filter((p) => p.event_id === e.id);
        const totalPages = eventPages.length;
        const completedPages = eventPages.filter((p) => completedPageIds.has(p.id)).length;
        const eventDealIds = eventPages.flatMap((p) => dealsByPage.get(p.id) || []);
        const totalDeals = eventDealIds.length;
        const solvedDeals = eventDealIds.filter((id) => solvedDealIds.has(id)).length;
        const totalCoins = eventPages.reduce((sum, p) => sum + (Number(p.coin_reward) || 0), 0);
        return {
          id: e.id,
          title: e.title,
          description: e.description,
          gameKind: e.game_kind,
          sortOrder: e.sort_order ?? null,
          startsAt: e.starts_at ?? null,
          isUpcoming: isUpcomingEvent(e.starts_at),
          totalPages,
          completedPages,
          fullyCompleted: totalPages > 0 && completedPages >= totalPages,
          totalDeals,
          solvedDeals,
          totalCoins,
        };
      })
      .sort(compareEventSummaries);

    const liveIds = new Set(result.map((r) => r.id));
    for (const staleId of Array.from(catalogMemory.keys())) {
      if (!liveIds.has(staleId)) await evictEvent(staleId);
    }
    kickOffCatalogSync(result.map((r) => r.id));
    return result;
  } catch {
    return buildSummaryFromCache();
  }
}

/**
 * Flat set of every seed used by any currently-visible event's deals,
 * wrapped in the `[{ seeds: number[] }]` shape core/randomSeed.js's
 * buildKnownSet() expects — it only ever flattens whatever `.seeds` arrays
 * it's given, so one synthetic group is sufficient (no need to keep events
 * separate). Used to keep curated event seeds out of Random Shuffle deals.
 * RLS on special_event_deals already restricts this to deals belonging to
 * visible events, so no join/date filtering is needed here. Returns []
 * (i.e. "no extra known seeds") on any failure — a random deal should never
 * be blocked by this being unreachable.
 * @returns {Promise<Array<{seeds: number[]}>>}
 */
export async function fetchAllEventSeeds() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('special_event_deals').select('seed');
  if (error || !data) return [];
  return [{ seeds: data.map((d) => d.seed) }];
}

/**
 * One event's full page list with per-page lock/completed state resolved,
 * and each page's deals with per-deal solved state (needed to render the
 * reveal grid — an unsolved deal shows its numbered button, a solved one is
 * permanently gone, exposing that slice of the page's postcard).
 * Locking rule: page 1 is always unlocked; page N is unlocked iff page N-1
 * is completed. Returns null if the event doesn't exist / isn't visible /
 * the fetch fails.
 * @param {string} eventId
 * @returns {Promise<{id:string, title:string, description:string|null,
 *   gameKind:string, sortOrder:number|null, startsAt:string|null,
 *   pages:Array<{id:number, pageNumber:number,
 *   gridSize:number, imagePath:string, coinReward:number, completed:boolean,
 *   unlocked:boolean, deals:Array<{id:number, position:number, dealNumber:number|null,
 *   seed:number, solved:boolean}>}>}|null>}
 */
export async function fetchEventDetail(eventId, opts) {
  if (!eventId) return null;
  const optimisticDealIds = Array.isArray(opts?.optimisticDealIds)
    ? opts.optimisticDealIds.filter((id) => id != null)
    : [];

  if (supabase) {
    try {
      // See fetchSpecialEvents: converge to a remote Factory Reset before
      // merging any local solved flags, so wiped progress can't resurrect
      // from this device's caches.
      await maybeApplyRemoteReset().catch(() => false);
      const [{ data: event, error: eventErr }, { data: pages, error: pagesErr }] = await Promise.all([
        supabase.from('special_events').select('id, title, description, game_kind, sort_order, starts_at').eq('id', eventId).maybeSingle(),
        supabase.from('special_event_pages').select('id, page_number, grid_size, image_path, coin_reward').eq('event_id', eventId).order('page_number'),
      ]);
      if (eventErr) throw eventErr;
      if (!event) {
        await evictEvent(eventId);
        return null;
      }

      const sortedPages = pagesErr ? [] : (pages || []).slice().sort((a, b) => a.page_number - b.page_number);

      let completedIds = new Set();
      const dealsByPage = new Map();
      if (sortedPages.length > 0) {
        const pageIds = sortedPages.map((p) => p.id);
        const [{ data: progress, error: progressErr }, dealsRes] = await Promise.all([
          supabase.from('event_page_progress').select('page_id').in('page_id', pageIds),
          // deal_number exists post-migration 029; fall back to the legacy
          // column list on a DB that hasn't been migrated yet.
          supabase.from('special_event_deals').select('id, page_id, position, seed, deal_number').in('page_id', pageIds).order('position'),
        ]);
        completedIds = new Set((progressErr ? [] : progress || []).map((r) => r.page_id));

        let dealRows = [];
        if (dealsRes.error && /deal_number/i.test(dealsRes.error.message || '')) {
          const legacy = await supabase.from('special_event_deals').select('id, page_id, position, seed').in('page_id', pageIds).order('position');
          dealRows = legacy.error ? [] : legacy.data || [];
        } else {
          dealRows = dealsRes.error ? [] : dealsRes.data || [];
        }
        let solvedDealIds = new Set();
        if (dealRows.length > 0) {
          const { data: dealProgress, error: dealProgressErr } = await supabase
            .from('event_deal_progress')
            .select('deal_id')
            .in('deal_id', dealRows.map((d) => d.id));
          solvedDealIds = new Set((dealProgressErr ? [] : dealProgress || []).map((r) => r.deal_id));
        }
        for (const d of dealRows) {
          const list = dealsByPage.get(d.page_id) || [];
          list.push({ id: d.id, position: d.position, dealNumber: d.deal_number ?? null, seed: d.seed, solved: solvedDealIds.has(d.id) });
          dealsByPage.set(d.page_id, list);
        }
      }

      let previousCompleted = true;
      const pagesWithState = assignDealNumbers(sortedPages.map((p) => {
        const completed = completedIds.has(p.id);
        const unlocked = previousCompleted;
        previousCompleted = completed;
        const deals = (dealsByPage.get(p.id) || []).slice().sort((a, b) => a.position - b.position);
        return {
          id: p.id,
          pageNumber: p.page_number,
          gridSize: p.grid_size,
          imagePath: p.image_path,
          coinReward: p.coin_reward,
          completed,
          unlocked,
          deals,
        };
      }));

      const detail = {
        id: event.id,
        title: event.title,
        description: event.description,
        gameKind: event.game_kind,
        sortOrder: event.sort_order ?? null,
        startsAt: event.starts_at ?? null,
        pages: pagesWithState,
      };

      try {
        const wonQueuedIds = await listWonQueuedDealIds();
        // Server-confirmed pending wins no longer need local trust.
        for (const id of Array.from(pendingWonDealIds)) {
          if (solvedDealIds.has(id)) pendingWonDealIds.delete(id);
        }
        // Local caches may hold solved=true written before losses stopped
        // counting as solved (Game Over freeze path). Only trust cached ids
        // that are verifiable — present on the server, in the won queue, in
        // the explicit optimistic list, or locally witnessed as a win — so a
        // flushed/queued loss can never resurrect as an exposed image slice,
        // while a genuine win survives the post-flush window where the queued
        // op is gone but the server row isn't readable yet.
        const cachedIds = [];
        const prev = catalogMemory.get(detail.id);
        if (prev) {
          for (const id of collectSolvedIds(prev)) cachedIds.push(id);
        }
        try {
          const dexieDetail = await getCatalogDetail(detail.id);
          if (dexieDetail) {
            for (const id of collectSolvedIds(dexieDetail)) cachedIds.push(id);
          }
        } catch {}
        const knownSolved = computeKnownSolved({
          serverIds: [...solvedDealIds],
          wonQueuedIds: [...wonQueuedIds],
          optimisticDealIds,
          pendingWonIds: [...pendingWonDealIds],
          cachedIds,
        });
        mergeSolvedIds(detail, knownSolved);
      } catch {}
      catalogMemory.set(detail.id, detail);
      saveCatalogDetail(detail).catch(() => {});
      for (const p of pagesWithState) {
        if (p.imagePath) ensureImageCached(p.imagePath).catch(() => {});
      }
      return detail;
    } catch {}
  }

  // Offline/error fallback: the Supabase block above threw, so there is no
  // server truth to converge to. Trust the Dexie row as-is (it already
  // reflects the last converged sync, including other devices' wins) and
  // union locally witnessed wins (pending, queued, or explicit optimistic),
  // so a just-won deal survives even when the Dexie optimistic put hasn't
  // landed yet and the server is unreachable.
  const wonQueuedIds = await listWonQueuedDealIds();
  const cached = await getCatalogDetail(eventId);
  if (cached) {
    applyWinPreservingMerge(cached, { wonQueuedIds: [...wonQueuedIds], optimisticDealIds });
    catalogMemory.set(eventId, cached);
    saveCatalogDetail(cached).catch(() => {});
  }
  return cached;
}
