// repo/rewardRulesRepository.js
// Cache-first client mirror of the server-side coin_reward_rules /
// coin_reward_settings tables (migration_032). Used ONLY for the optimistic
// display (toast text, coin flight count, pre-sync bump) — the server
// recomputes authoritatively on flush, so staleness here only briefly
// mis-displays, never mints.
//
// Layers: memory (1h TTL) -> Dexie rewardRules -> bundled seed defaults.
// Offline-first: every layer degrades to the next; failures return the
// bundled defaults rather than throwing.

import { supabase } from '../lib/supabaseClient.js';
import { getRewardRulesCache, setRewardRulesCache } from '../db/rewardRulesCache.js';

const TTL_MS = 60 * 60 * 1000;

// Bundled fallback: mirrors the migration_032 seeds. Keep in sync when the
// seeds change; the live tables override this on every successful fetch.
const FALLBACK_RULES = {
  winning: {
    base_reward: 10,
    fast_ms_threshold: 300000,
    fast_bonus: 3,
    few_moves_threshold: 100,
    few_moves_bonus: 2,
  },
  daily: {
    base_reward: 15,
    fast_ms_threshold: 300000,
    fast_bonus: 3,
    few_moves_threshold: 100,
    few_moves_bonus: 2,
  },
  random: {
    base_reward: 5,
    fast_ms_threshold: 300000,
    fast_bonus: 3,
    few_moves_threshold: 100,
    few_moves_bonus: 2,
  },
  event: {
    base_reward: 10,
    fast_ms_threshold: 300000,
    fast_bonus: 3,
    few_moves_threshold: 100,
    few_moves_bonus: 2,
  },
};

const FALLBACK_SETTINGS = {
  fallbackBase: 5,
};

let memory = null;
let fetchedAt = 0;

function toConfig(rows, settingsRows) {
  const rules = { ...FALLBACK_RULES };
  for (const r of rows || []) {
    if (!r || !r.game_kind) continue;
    rules[r.game_kind] = {
      base_reward: r.base_reward ?? 0,
      fast_ms_threshold: r.fast_ms_threshold ?? null,
      fast_bonus: r.fast_bonus ?? 0,
      few_moves_threshold: r.few_moves_threshold ?? null,
      few_moves_bonus: r.few_moves_bonus ?? 0,
    };
  }
  let fallbackBase = FALLBACK_SETTINGS.fallbackBase;
  for (const s of settingsRows || []) {
    if (s && s.key === 'fallback_base_reward' && Number.isFinite(s.value_int)) {
      fallbackBase = s.value_int;
    }
  }
  return { rules, fallbackBase };
}

function fallbackConfig() {
  return { rules: { ...FALLBACK_RULES }, fallbackBase: FALLBACK_SETTINGS.fallbackBase };
}

/**
 * Refresh the cached reward config from Supabase. Never throws — failures
 * keep the previous (or bundled) config.
 * @returns {Promise<object>} the active config
 */
export async function refreshRewardRules() {
  try {
    if (!supabase) return getRewardConfigSync();
    const [rulesRes, settingsRes] = await Promise.all([
      supabase.from('coin_reward_rules').select('game_kind, base_reward, fast_ms_threshold, fast_bonus, few_moves_threshold, few_moves_bonus'),
      supabase.from('coin_reward_settings').select('key, value_int'),
    ]);
    if (rulesRes.error) throw rulesRes.error;
    if (settingsRes.error) throw settingsRes.error;
    const config = toConfig(rulesRes.data, settingsRes.data);
    memory = config;
    fetchedAt = Date.now();
    setRewardRulesCache(config).catch(() => {});
    return config;
  } catch {
    return getRewardConfigSync();
  }
}

/**
 * Synchronous read of the best-known config (memory -> bundled fallback).
 * Dexie hydration is async, so call hydrateRewardRules() at boot to promote
 * the persisted snapshot into memory.
 * @returns {object}
 */
export function getRewardConfigSync() {
  if (memory && Date.now() - fetchedAt < TTL_MS) return memory;
  if (memory) return memory;
  return fallbackConfig();
}

/** Promote the Dexie snapshot into memory (call at boot, fire-and-forget). */
export async function hydrateRewardRules() {
  try {
    const row = await getRewardRulesCache();
    if (row && row.value && row.value.rules) {
      memory = row.value;
      fetchedAt = row.fetchedAt || 0;
    }
  } catch {}
}
