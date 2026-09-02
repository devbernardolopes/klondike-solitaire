// repo/specialEventsRepository.js
// Data layer for the Phase-1 schema (special_events -> special_event_pages ->
// special_event_deals, plus per-user event_deal_progress / event_page_progress /
// event_progress). Deliberately separate from repo/seedRepository.js — that
// module still serves the OLD flat event model consumed by EventDetailModal.jsx
// until Phase 3/4 replace it; this module is net-new and only feeds the Phase 2
// events list.
//
// No offline cache/TTL layer here (unlike seedRepository.js's winning/daily
// pools) — mirrors AchievementsModal.jsx's approach of a live fetch on open
// with a graceful empty-array fallback. Visibility (enabled + starts_at) is
// enforced server-side via RLS on special_events, so a "hidden" event simply
// never appears in `events` here — no client-side date filtering needed.

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
