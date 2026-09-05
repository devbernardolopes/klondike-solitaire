import { supabase } from '../lib/supabaseClient.js';
import { db } from '../db/schema.js';
import { saveCatalogDetail, getCatalogDetail, deleteCatalogDetail, deleteImageBlob } from '../db/eventCache.js';
import { ensureImageCached, warmImageCache } from '../utils/eventImageCache.js';
import { collectSolvedIds, mergeSolvedIds, getEventDealProgress } from './specialEventsProgress.js';
import { listQueuedOps } from '../db/syncQueue.js';
import { maybeApplyRemoteReset } from '../sync/factoryReset.js';

const catalogMemory = new Map();

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
}

export function patchCachedEventDealSolved(dealId) {
  if (dealId == null) return null;
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
      if (r.detail && r.eventId) catalogMemory.set(r.eventId, r.detail);
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
    }
  }
  return false;
}

function summaryFromDetail(detail) {
  const totalPages = detail.pages.length;
  const completedPages = detail.pages.filter((p) => p.completed).length;
  const { totalDeals, solvedDeals } = getEventDealProgress(detail);
  return {
    id: detail.id,
    title: detail.title,
    description: detail.description,
    gameKind: detail.gameKind,
    sortOrder: detail.sortOrder ?? null,
    startsAt: detail.startsAt ?? null,
    totalPages,
    completedPages,
    fullyCompleted: totalPages > 0 && completedPages >= totalPages,
    totalDeals,
    solvedDeals,
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
 *   totalPages:number, completedPages:number, fullyCompleted:boolean,
 *   totalDeals:number, solvedDeals:number}>>}
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
      supabase.from('special_event_pages').select('id, event_id').order('page_number'),
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
        try {
          const queued = await listQueuedOps();
          for (const op of queued) {
            const dealId = op?.type === 'submit_game_result' ? op?.payload?.p_event_deal_id : null;
            if (dealId != null) solvedDealIds.add(dealId);
          }
        } catch {}
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
        return {
          id: e.id,
          title: e.title,
          description: e.description,
          gameKind: e.game_kind,
          sortOrder: e.sort_order ?? null,
          startsAt: e.starts_at ?? null,
          totalPages,
          completedPages,
          fullyCompleted: totalPages > 0 && completedPages >= totalPages,
          totalDeals,
          solvedDeals,
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
 *   unlocked:boolean, deals:Array<{id:number, position:number, seed:number,
 *   solved:boolean}>}>}|null>}
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
        const [{ data: progress, error: progressErr }, { data: deals, error: dealsErr }] = await Promise.all([
          supabase.from('event_page_progress').select('page_id').in('page_id', pageIds),
          supabase.from('special_event_deals').select('id, page_id, position, seed').in('page_id', pageIds).order('position'),
        ]);
        completedIds = new Set((progressErr ? [] : progress || []).map((r) => r.page_id));

        const dealRows = dealsErr ? [] : deals || [];
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
          list.push({ id: d.id, position: d.position, seed: d.seed, solved: solvedDealIds.has(d.id) });
          dealsByPage.set(d.page_id, list);
        }
      }

      let previousCompleted = true;
      const pagesWithState = sortedPages.map((p) => {
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
      });

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
        const knownSolved = new Set(optimisticDealIds);
        const prev = catalogMemory.get(detail.id);
        if (prev) {
          for (const id of collectSolvedIds(prev)) knownSolved.add(id);
        }
        try {
          const dexieDetail = await getCatalogDetail(detail.id);
          if (dexieDetail) {
            for (const id of collectSolvedIds(dexieDetail)) knownSolved.add(id);
          }
        } catch {}
        try {
          const queued = await listQueuedOps();
          for (const op of queued) {
            const dealId = op?.type === 'submit_game_result' ? op?.payload?.p_event_deal_id : null;
            if (dealId != null) knownSolved.add(dealId);
          }
        } catch {}
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

  const cached = await getCatalogDetail(eventId);
  if (cached) catalogMemory.set(eventId, cached);
  return cached;
}
