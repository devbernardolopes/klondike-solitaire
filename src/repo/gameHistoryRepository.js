// repo/gameHistoryRepository.js
// Read path for the History view (Main Menu > History). Supabase's
// game_results table is the authority; the local sync outbox contributes
// still-queued (not yet flushed) results as "pending" rows on top.
//
// Dedupe rule: a queued op whose p_game_id already appears in the fetched
// server rows is dropped — the server dedupes on unique (user_id, game_id),
// so once a queued result flushes it shows up as a server row and the
// pending twin disappears instead of duplicating.
//
// Event names are NOT stored in game_results (only game_kind + seed), so
// event-kind rows resolve their title via special_event_deals.seed, batched
// one query per page (the deals/pages/events catalogs are public-read).

import { supabase } from '../lib/supabaseClient.js';
import { listQueuedOps } from '../db/syncQueue.js';

export const HISTORY_PAGE_SIZE = 25;

const HISTORY_COLUMNS = [
  'id',
  'game_id',
  'won',
  'moves',
  'duration_ms',
  'score',
  'undos',
  'seed',
  'game_kind',
  'hint_used',
  'undo_used',
  'tableau_to_tableau_moves',
  'foundation_moves',
  'foundation_to_tableau_moves',
  'recycle_count',
  'foundation_first_eligible',
  'ace_collector_eligible',
  'aces_to_foundation',
  'ace_ids_to_foundation',
  'created_at',
].join(',');

/**
 * Map a queued submit_game_result op payload to a pending history entry.
 * Losses enqueue without seed/kind, so those stay null (rendered generic).
 * @param {object} op  queued op row ({ id, payload, createdAt })
 * @returns {object} pending history entry
 */
export function queuedOpToHistoryEntry(op) {
  const p = op?.payload ?? {};
  return {
    key: `pending-${op?.id ?? Math.random()}`,
    gameId: p.p_game_id ?? null,
    won: Boolean(p.p_won),
    moves: p.p_moves ?? null,
    durationMs: p.p_duration_ms ?? null,
    score: p.p_score ?? 0,
    undos: p.p_undos ?? 0,
    seed: p.p_seed ?? null,
    gameKind: p.p_game_kind ?? null,
    hintUsed: Boolean(p.p_hint_used),
    undoUsed: Boolean(p.p_undo_used),
    tableauToTableauMoves: p.p_tableau_to_tableau_moves ?? 0,
    foundationMoves: p.p_foundation_moves ?? 0,
    foundationToTableauMoves: p.p_foundation_to_tableau_moves ?? 0,
    recycleCount: p.p_recycle_count ?? 0,
    foundationFirstEligible: p.p_foundation_first_eligible ?? true,
    aceCollectorEligible: p.p_ace_collector_eligible ?? true,
    acesToFoundation: p.p_aces_to_foundation ?? 0,
    aceIdsToFoundation: [],
    eventTitle: null,
    createdAt: new Date(op?.createdAt ?? Date.now()).toISOString(),
    pending: true,
  };
}

/**
 * Map a game_results server row to a history entry.
 * @param {object} row
 * @returns {object} history entry
 */
export function serverRowToHistoryEntry(row) {
  return {
    key: `server-${row.id}`,
    gameId: row.game_id ?? null,
    won: Boolean(row.won),
    moves: row.moves,
    durationMs: row.duration_ms,
    score: row.score ?? 0,
    undos: row.undos ?? 0,
    seed: row.seed ?? null,
    gameKind: row.game_kind ?? null,
    hintUsed: Boolean(row.hint_used),
    undoUsed: Boolean(row.undo_used),
    tableauToTableauMoves: row.tableau_to_tableau_moves ?? 0,
    foundationMoves: row.foundation_moves ?? 0,
    foundationToTableauMoves: row.foundation_to_tableau_moves ?? 0,
    recycleCount: row.recycle_count ?? 0,
    foundationFirstEligible: row.foundation_first_eligible ?? true,
    aceCollectorEligible: row.ace_collector_eligible ?? true,
    acesToFoundation: row.aces_to_foundation ?? 0,
    aceIdsToFoundation: Array.isArray(row.ace_ids_to_foundation) ? row.ace_ids_to_foundation : [],
    eventTitle: null,
    createdAt: row.created_at,
    pending: false,
  };
}

/**
 * Merge server entries with pending queued entries. Pending rows that match
 * a server row by game_id are dropped (already flushed). Pending rows sort
 * first (newest first); server rows keep their fetched order.
 * @param {object[]} serverEntries
 * @param {object[]} queuedOps  raw syncQueue rows
 * @returns {object[]} merged entries
 */
export function mergeHistoryEntries(serverEntries, queuedOps) {
  const serverGameIds = new Set(
    (serverEntries ?? []).map((e) => e.gameId).filter((id) => id != null),
  );
  const pending = (queuedOps ?? [])
    .filter((op) => op?.type === 'submit_game_result')
    .map(queuedOpToHistoryEntry)
    .filter((e) => e.gameId == null || !serverGameIds.has(e.gameId));
  pending.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return [...pending, ...(serverEntries ?? [])];
}

/**
 * Resolve event titles for event-kind entries by seed, batched. Mutates the
 * passed entries in place (sets eventTitle) and returns the seed→title map.
 * Best-effort: any failure leaves titles null (generic "event" label).
 * @param {object[]} entries
 * @returns {Promise<Record<string, string|null>>}
 */
export async function resolveEventTitles(entries) {
  const seeds = [
    ...new Set(
      (entries ?? [])
        .filter((e) => e.gameKind === 'event' && e.seed != null && !e.eventTitle)
        .map((e) => e.seed),
    ),
  ];
  if (seeds.length === 0 || !supabase) return {};
  try {
    const { data: deals, error: dealsError } = await supabase
      .from('special_event_deals')
      .select('seed, page_id')
      .in('seed', seeds);
    if (dealsError || !deals?.length) return {};
    const pageIds = [...new Set(deals.map((d) => d.page_id))];
    const { data: pages, error: pagesError } = await supabase
      .from('special_event_pages')
      .select('id, event_id')
      .in('id', pageIds);
    if (pagesError || !pages?.length) return {};
    const pageToEvent = new Map(pages.map((p) => [p.id, p.event_id]));
    const eventIds = [...new Set(pages.map((p) => p.event_id))];
    const { data: events, error: eventsError } = await supabase
      .from('special_events')
      .select('id, title')
      .in('id', eventIds);
    if (eventsError || !events?.length) return {};
    const eventToTitle = new Map(events.map((e) => [e.id, e.title]));
    const seedToTitle = {};
    for (const deal of deals) {
      const eventId = pageToEvent.get(deal.page_id);
      const title = eventId != null ? (eventToTitle.get(eventId) ?? null) : null;
      if (seedToTitle[deal.seed] == null) seedToTitle[deal.seed] = title;
    }
    for (const entry of entries) {
      if (entry.gameKind === 'event' && entry.seed != null && !entry.eventTitle) {
        entry.eventTitle = seedToTitle[entry.seed] ?? null;
      }
    }
    return seedToTitle;
  } catch {
    return {};
  }
}

/**
 * Fetch one page of the user's game history, newest first. Keyset cursor
 * (created_at + id) so newly inserted rows never shift pages. RLS scopes to
 * the caller automatically (game_results_select_own).
 * @param {{ createdAt?: string|null, id?: string|null, limit?: number }} [cursor]
 * @returns {Promise<{ entries: object[], nextCursor: { createdAt: string, id: string }|null }>}
 */
export async function fetchHistoryPage(cursor = {}) {
  if (!supabase) throw new Error('offline');
  const limit = cursor.limit ?? HISTORY_PAGE_SIZE;
  let query = supabase
    .from('game_results')
    .select(HISTORY_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (cursor.createdAt != null && cursor.id != null) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const entries = page.map(serverRowToHistoryEntry);
  const last = page[page.length - 1];
  return {
    entries,
    nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
  };
}

/**
 * List locally queued (not yet flushed) submit_game_result ops for the
 * pending-rows merge. Never throws — offline/empty outbox yields [].
 * @returns {Promise<object[]>}
 */
export async function listPendingResultOps() {
  try {
    const ops = await listQueuedOps();
    return (ops ?? []).filter((op) => op?.type === 'submit_game_result');
  } catch {
    return [];
  }
}
