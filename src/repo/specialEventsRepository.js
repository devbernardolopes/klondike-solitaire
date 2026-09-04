import { supabase } from '../lib/supabaseClient.js';
import { db } from '../db/schema.js';
import { saveCatalogDetail, getCatalogDetail } from '../db/eventCache.js';
import { ensureImageCached, warmImageCache } from '../utils/eventImageCache.js';

const catalogMemory = new Map();

export function getCachedEventDetailSync(eventId) {
  return catalogMemory.get(eventId) ?? null;
}

export function getCachedEventsSummarySync() {
  if (catalogMemory.size === 0) return null;
  const list = Array.from(catalogMemory.values()).map(summaryFromDetail);
  return list.length ? list.sort((a, b) => a.id.localeCompare(b.id)) : null;
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
  return {
    id: detail.id,
    title: detail.title,
    description: detail.description,
    gameKind: detail.gameKind,
    totalPages,
    completedPages,
    fullyCompleted: totalPages > 0 && completedPages >= totalPages,
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
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
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
 * Deal-level progress is intentionally NOT fetched here — the list only
 * needs page counts. Returns [] on any failure (offline, RLS denial, etc.)
 * rather than throwing, so the modal can always render its empty state.
 * @returns {Promise<Array<{id:string, title:string, description:string|null,
 *   gameKind:string, totalPages:number, completedPages:number,
 *   fullyCompleted:boolean}>>}
 */
export async function fetchSpecialEvents() {
  if (!supabase) {
    return buildSummaryFromCache();
  }

  try {
    const [{ data: events, error: eventsErr }, { data: pages, error: pagesErr }, { data: progress, error: progressErr }] = await Promise.all([
      supabase.from('special_events').select('id, title, description, game_kind, sort_order').order('sort_order'),
      supabase.from('special_event_pages').select('id, event_id').order('page_number'),
      supabase.from('event_page_progress').select('page_id'),
    ]);
    if (eventsErr) throw eventsErr;
    if (!events || events.length === 0) return [];

    const pageRows = pagesErr ? [] : pages || [];
    const completedPageIds = new Set((progressErr ? [] : progress || []).map((r) => r.page_id));

    const result = events.map((e) => {
      const eventPages = pageRows.filter((p) => p.event_id === e.id);
      const totalPages = eventPages.length;
      const completedPages = eventPages.filter((p) => completedPageIds.has(p.id)).length;
      return {
        id: e.id,
        title: e.title,
        description: e.description,
        gameKind: e.game_kind,
        totalPages,
        completedPages,
        fullyCompleted: totalPages > 0 && completedPages >= totalPages,
      };
    });

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
 *   gameKind:string, pages:Array<{id:number, pageNumber:number,
 *   gridSize:number, imagePath:string, coinReward:number, completed:boolean,
 *   unlocked:boolean, deals:Array<{id:number, position:number, seed:number,
 *   solved:boolean}>}>}|null>}
 */
export async function fetchEventDetail(eventId) {
  if (!eventId) return null;

  if (supabase) {
    try {
      const [{ data: event, error: eventErr }, { data: pages, error: pagesErr }] = await Promise.all([
        supabase.from('special_events').select('id, title, description, game_kind').eq('id', eventId).maybeSingle(),
        supabase.from('special_event_pages').select('id, page_number, grid_size, image_path, coin_reward').eq('event_id', eventId).order('page_number'),
      ]);
      if (eventErr || !event) throw eventErr || new Error('no event');

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
        pages: pagesWithState,
      };

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
