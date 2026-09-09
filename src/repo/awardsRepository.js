// repo/awardsRepository.js
// "Awards" showcase data: unlocked achievements + unlocked event postcards
// (completed event pages), merged into one unlock-ordered list for the
// AwardsModal shelves. Pure collect/sort/paginate helpers are unit-tested;
// fetchAwardItems() orchestrates the cached-first async loads.

import { supabase } from '../lib/supabaseClient.js';
import {
  getCachedAchievementsSync,
  fetchAchievements,
} from './achievementRepository.js';
import {
  getCachedEventsSummarySync,
  getCachedEventDetailSync,
  fetchSpecialEvents,
  fetchEventDetail,
} from './specialEventsRepository.js';

/**
 * @typedef {Object} AwardItem
 * @property {'achievement'|'postcard'} kind
 * @property {string} id        unique across both kinds
 * @property {string} title     untranslated fallback title
 * @property {string|null} imagePath  catalog image path for the tile
 * @property {string|null} unlockedAt ISO timestamp of the unlock, null when unknown
 * @property {any} ref          source record for detail-modal launching
 */

function timeOf(item) {
  const t = item?.unlockedAt ? Date.parse(item.unlockedAt) : NaN;
  return Number.isFinite(t) ? t : Infinity;
}

/**
 * Merge achievement + postcard awards into unlock order (oldest first).
 * Items without a known timestamp sink last, achievements before postcards
 * on ties, then by id for full determinism. Pure.
 * @param {{achievements?:AwardItem[], postcards?:AwardItem[]}} parts
 * @returns {AwardItem[]}
 */
export function collectAwards({ achievements = [], postcards = [] } = {}) {
  const all = [...(achievements || []), ...(postcards || [])];
  all.sort((a, b) => {
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (ta !== tb) return ta - tb;
    if (a.kind !== b.kind) return a.kind === 'achievement' ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
  return all;
}

/**
 * Chunk items into shelf pages of at most perPage tiles. Always returns at
 * least one page (empty when there is nothing unlocked) so the modal renders
 * empty shelves instead of nothing. Pure.
 * @param {AwardItem[]} items
 * @param {number} perPage
 * @returns {AwardItem[][]}
 */
export function paginateAwards(items, perPage) {
  const size = Number.isFinite(perPage) ? Math.max(1, Math.floor(perPage)) : 1;
  const pages = [];
  for (let i = 0; i < (items || []).length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages.length ? pages : [[]];
}

/**
 * Load every unlocked award, cached-first. Achievements need the server
 * unlocked set (no local mirror exists), so offline they are skipped;
 * postcards come from cached event details offline and converge online.
 * Never throws — resolves [] when nothing is available.
 * @returns {Promise<AwardItem[]>}
 */
export async function fetchAwardItems() {
  let defs = getCachedAchievementsSync();
  if ((!defs || defs.length === 0) && supabase) {
    try {
      defs = await fetchAchievements();
    } catch {}
  }

  let unlockedMap = {};
  if (supabase) {
    try {
      const res = await supabase
        .from('achievements_unlocked')
        .select('achievement_id, unlocked_at');
      if (!res.error && Array.isArray(res.data)) {
        for (const row of res.data) {
          if (row?.achievement_id != null) unlockedMap[row.achievement_id] = row.unlocked_at ?? null;
        }
      }
    } catch {}
  }

  let summaries = getCachedEventsSummarySync();
  if ((!summaries || summaries.length === 0) && supabase) {
    try {
      summaries = await fetchSpecialEvents();
    } catch {}
  }
  const details = [];
  for (const s of summaries || []) {
    if (!s || s.id == null) continue;
    let detail = getCachedEventDetailSync(s.id);
    if (!detail && supabase) {
      try {
        detail = await fetchEventDetail(s.id);
      } catch {}
    }
    if (detail) details.push(detail);
  }

  const achievements = (defs || [])
    .filter((d) => d?.id != null && unlockedMap[d.id] != null)
    .map((d) => ({
      kind: 'achievement',
      id: `achievement:${d.id}`,
      title: d.name || d.id,
      imagePath: d.image_path ?? null,
      unlockedAt: unlockedMap[d.id] ?? null,
      ref: d,
    }));

  const postcards = [];
  for (const detail of details) {
    for (const p of detail.pages || []) {
      if (!p || !p.completed) continue;
      postcards.push({
        kind: 'postcard',
        id: `postcard:${detail.id}:${p.id}`,
        title: detail.title || detail.id,
        imagePath: p.imagePath ?? null,
        unlockedAt: p.completedAt ?? null,
        ref: { eventId: detail.id, pageNumber: p.pageNumber, title: detail.title },
      });
    }
  }

  return collectAwards({ achievements, postcards });
}
