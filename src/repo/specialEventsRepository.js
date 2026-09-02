// repo/specialEventsRepository.js
// Data layer for the Phase-1 schema (special_events -> special_event_pages ->
// special_event_deals, plus per-user event_deal_progress / event_page_progress /
// event_progress).
//
// No offline cache/TTL layer here (unlike seedRepository.js's winning/daily
// pools) — mirrors AchievementsModal.jsx's approach of a live fetch on open
// with a graceful empty/null fallback. Visibility (enabled + starts_at) is
// enforced server-side via RLS on special_events (and cascades to its pages/
// deals), so a hidden event simply never appears here — no client date logic.

import { supabase } from '../lib/supabaseClient.js';

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
  if (!supabase) return [];

  const { data: events, error: eventsErr } = await supabase
    .from('special_events')
    .select('id, title, description, game_kind, sort_order')
    .order('sort_order');
  if (eventsErr || !events || events.length === 0) return [];

  const { data: pages, error: pagesErr } = await supabase
    .from('special_event_pages')
    .select('id, event_id')
    .order('page_number');
  const pageRows = pagesErr ? [] : pages || [];

  // event_page_progress is RLS-scoped to auth.uid() = user_id, so this
  // already returns only the current session's completed pages.
  const { data: progress, error: progressErr } = await supabase
    .from('event_page_progress')
    .select('page_id');
  const completedPageIds = new Set((progressErr ? [] : progress || []).map((r) => r.page_id));

  return events.map((e) => {
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
  if (!supabase || !eventId) return null;

  const { data: event, error: eventErr } = await supabase
    .from('special_events')
    .select('id, title, description, game_kind')
    .eq('id', eventId)
    .maybeSingle();
  if (eventErr || !event) return null;

  const { data: pages, error: pagesErr } = await supabase
    .from('special_event_pages')
    .select('id, page_number, grid_size, image_path, coin_reward')
    .eq('event_id', eventId)
    .order('page_number');
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

  let previousCompleted = true; // page 1 always unlocked
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

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    gameKind: event.game_kind,
    pages: pagesWithState,
  };
}
