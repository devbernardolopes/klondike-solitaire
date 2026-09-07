// repo/limitRulesRepository.js
// Cache-first client mirror of the server-side game_limit_rules /
// game_limit_settings tables (migration_033). Used for the REAL-TIME
// game-over enforcement (freeze/checkTimeLimit/addMoves read this) — unlike
// coin rewards, limits cannot wait for flush-time reconciliation, so the
// cached config IS the enforcement input while offline or stale. The server
// re-judges every claimed win on flush and rejects over-limit wins, so a
// tampered cache only delays the verdict, never avoids it.
//
// Layers: memory (1h TTL) -> Dexie limitRules -> bundled seed defaults.
// Offline-first: every layer degrades to the next; failures return the
// bundled defaults rather than throwing.

import { supabase } from '../lib/supabaseClient.js';
import { getLimitRulesCache, setLimitRulesCache } from '../db/limitRulesCache.js';

const TTL_MS = 60 * 60 * 1000;

export const FALLBACK_MAX_TIME_MS = 1800000;
export const FALLBACK_MAX_MOVES = 500;

// Bundled fallback: mirrors the migration_033 seeds. Keep in sync when the
// seeds change; the live tables override this on every successful fetch.
const FALLBACK_RULES = {
  winning: { max_time_ms: 1800000, max_moves: 500 },
  daily: { max_time_ms: 1800000, max_moves: 500 },
  random: { max_time_ms: 1800000, max_moves: 500 },
  event: { max_time_ms: 1800000, max_moves: 500 },
};

const FALLBACK_SETTINGS = {
  fallbackMaxTimeMs: FALLBACK_MAX_TIME_MS,
  fallbackMaxMoves: FALLBACK_MAX_MOVES,
};

let memory = null;
let fetchedAt = 0;

function toConfig(rows, settingsRows) {
  const rules = {};
  for (const key of Object.keys(FALLBACK_RULES)) {
    rules[key] = { ...FALLBACK_RULES[key] };
  }
  for (const r of rows || []) {
    if (!r || !r.game_kind) continue;
    rules[r.game_kind] = {
      max_time_ms: Number.isFinite(r.max_time_ms) && r.max_time_ms > 0 ? r.max_time_ms : FALLBACK_MAX_TIME_MS,
      max_moves: Number.isFinite(r.max_moves) && r.max_moves > 0 ? r.max_moves : FALLBACK_MAX_MOVES,
    };
  }
  let fallbackMaxTimeMs = FALLBACK_SETTINGS.fallbackMaxTimeMs;
  let fallbackMaxMoves = FALLBACK_SETTINGS.fallbackMaxMoves;
  for (const s of settingsRows || []) {
    if (!s) continue;
    if (s.key === 'fallback_max_time_ms' && Number.isFinite(s.value_int) && s.value_int > 0) {
      fallbackMaxTimeMs = s.value_int;
    }
    if (s.key === 'fallback_max_moves' && Number.isFinite(s.value_int) && s.value_int > 0) {
      fallbackMaxMoves = s.value_int;
    }
  }
  return { rules, fallbackMaxTimeMs, fallbackMaxMoves };
}

function fallbackConfig() {
  const rules = {};
  for (const key of Object.keys(FALLBACK_RULES)) {
    rules[key] = { ...FALLBACK_RULES[key] };
  }
  return { rules, fallbackMaxTimeMs: FALLBACK_SETTINGS.fallbackMaxTimeMs, fallbackMaxMoves: FALLBACK_SETTINGS.fallbackMaxMoves };
}

/**
 * Refresh the cached limit config from Supabase. Never throws — failures
 * keep the previous (or bundled) config.
 * @returns {Promise<object>} the active config
 */
export async function refreshLimitRules() {
  try {
    if (!supabase) return getLimitConfigSync();
    const [rulesRes, settingsRes] = await Promise.all([
      supabase.from('game_limit_rules').select('game_kind, max_time_ms, max_moves'),
      supabase.from('game_limit_settings').select('key, value_int'),
    ]);
    if (rulesRes.error) throw rulesRes.error;
    if (settingsRes.error) throw settingsRes.error;
    const config = toConfig(rulesRes.data, settingsRes.data);
    memory = config;
    fetchedAt = Date.now();
    setLimitRulesCache(config).catch(() => {});
    return config;
  } catch {
    return getLimitConfigSync();
  }
}

/**
 * Synchronous read of the best-known config (memory -> bundled fallback).
 * Dexie hydration is async, so call hydrateLimitRules() at boot to promote
 * the persisted snapshot into memory.
 * @returns {object}
 */
export function getLimitConfigSync() {
  if (memory && Date.now() - fetchedAt < TTL_MS) return memory;
  if (memory) return memory;
  return fallbackConfig();
}

/**
 * Resolve the enforced limits for a game kind (unknown kinds use the
 * fallback pair, mirroring the server's COALESCE behavior).
 * @param {string|null} [gameKind]
 * @returns {{maxTimeMs:number, maxMoves:number}}
 */
export function limitsFor(gameKind) {
  const config = getLimitConfigSync();
  const row = (gameKind != null && config.rules[gameKind]) || null;
  return {
    maxTimeMs: row ? row.max_time_ms : config.fallbackMaxTimeMs,
    maxMoves: row ? row.max_moves : config.fallbackMaxMoves,
  };
}

/** Promote the Dexie snapshot into memory (call at boot, fire-and-forget). */
export async function hydrateLimitRules() {
  try {
    const row = await getLimitRulesCache();
    if (row && row.value && row.value.rules) {
      memory = row.value;
      fetchedAt = row.fetchedAt || 0;
    }
  } catch {}
}

/** Test hook: reset the in-memory config. */
export function clearLimitRulesMemory() {
  memory = null;
  fetchedAt = 0;
}
