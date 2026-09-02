// repo/specialEventsRepository.js
// Data layer for the Phase-1 schema (special_events -> special_event_pages ->
// special_event_deals, plus per-user event_deal_progress / event_page_progress /
// event_progress). Deliberately separate from repo/seedRepository.js — that
// module still serves the OLD flat event model consumed by core/specialEvents.js
// until Phase 4 replaces it; this module is net-new.
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
 * One event's full page list with per-page lock/completed state resolved.
 * Locking rule: page 1 is always unlocked; page N is unlocked iff page N-1
 * is completed. Deal-level detail is intentionally NOT fetched here — that
 * arrives in Phase 4 alongside the reveal grid. Returns null if the event
 * doesn't exist / isn't visible / the fetch fails.
 * @param {string} eventId
 * @returns {Promise<{id:string, title:string, description:string|null,
 *   gameKind:string, pages:Array<{id:number, pageNumber:number,
 *   gridSize:number, imagePath:string, coinReward:number,
 *   completed:boolean, unlocked:boolean}>}|null>}
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
  if (sortedPages.length > 0) {
    const { data: progress, error: progressErr } = await supabase
      .from('event_page_progress')
      .select('page_id')
      .in('page_id', sortedPages.map((p) => p.id));
    completedIds = new Set((progressErr ? [] : progress || []).map((r) => r.page_id));
  }

  let previousCompleted = true; // page 1 always unlocked
  const pagesWithState = sortedPages.map((p) => {
    const completed = completedIds.has(p.id);
    const unlocked = previousCompleted;
    previousCompleted = completed;
    return {
      id: p.id,
      pageNumber: p.page_number,
      gridSize: p.grid_size,
      imagePath: p.image_path,
      coinReward: p.coin_reward,
      completed,
      unlocked,
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
