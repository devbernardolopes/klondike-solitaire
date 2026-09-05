import { supabase } from '../lib/supabaseClient.js';
import { getSeedCache, setSeedCache } from '../db/seedCache.js';
import fallbackWinning from '../data/solvableSeeds.json' with { type: 'json' };
import fallbackDaily from '../data/dailyChallenge.json' with { type: 'json' };

const TTL_MS = 24 * 60 * 60 * 1000;

let memoryCache = {
  winning: null,
  daily: null,
  fetchedAt: {},
};

function isStale(key) {
  const t = memoryCache.fetchedAt[key];
  if (!t) return true;
  return Date.now() - t > TTL_MS;
}

async function getCachedValue(key) {
  const row = await getSeedCache(key).catch(() => null);
  if (!row) return null;
  if (Date.now() - row.fetchedAt > TTL_MS) return null;
  return row.value;
}

async function fetchWinningSupabase() {
  if (!supabase) return null;
  const { data, error } = await supabase.from('winning_seeds').select('seed').eq('enabled', true).order('sort_order');
  if (error) return null;
  return (data || []).map((r) => r.seed);
}

async function fetchDailySupabase() {
  if (!supabase) return null;
  const { data, error } = await supabase.from('daily_seeds').select('date,seed').eq('enabled', true).order('date');
  if (error) return null;
  const map = {};
  for (const r of data || []) map[r.date] = r.seed;
  return map;
}

export async function getWinningPool() {
  if (memoryCache.winning && !isStale('winning')) return memoryCache.winning;
  const cached = await getCachedValue('winning');
  if (cached && !isStale('winning')) {
    memoryCache.winning = cached;
    return cached;
  }
  const remote = await fetchWinningSupabase();
  if (remote && remote.length > 0) {
    memoryCache.winning = remote;
    memoryCache.fetchedAt.winning = Date.now();
    setSeedCache('winning', remote).catch(() => {});
    return remote;
  }
  if (cached) {
    memoryCache.winning = cached;
    return cached;
  }
  const fallback = Array.isArray(fallbackWinning) ? fallbackWinning : [];
  memoryCache.winning = fallback;
  memoryCache.fetchedAt.winning = Date.now();
  return fallback;
}

export async function getDailyMap() {
  if (memoryCache.daily && !isStale('daily')) return memoryCache.daily;
  const cached = await getCachedValue('daily');
  if (cached && !isStale('daily')) {
    memoryCache.daily = cached;
    return cached;
  }
  const remote = await fetchDailySupabase();
  if (remote && Object.keys(remote).length > 0) {
    memoryCache.daily = remote;
    memoryCache.fetchedAt.daily = Date.now();
    setSeedCache('daily', remote).catch(() => {});
    return remote;
  }
  if (cached) {
    memoryCache.daily = cached;
    return cached;
  }
  const fallback = fallbackDaily && fallbackDaily.seeds ? fallbackDaily.seeds : {};
  memoryCache.daily = fallback;
  memoryCache.fetchedAt.daily = Date.now();
  return fallback;
}

export async function getDailyMeta() {
  const cached = await getCachedValue('dailyMeta').catch(() => null);
  if (cached && !isStale('dailyMeta')) return cached;
  if (!supabase) {
    const fb = { anchor: fallbackDaily?.anchor || null, windowYears: fallbackDaily?.windowYears || 0 };
    return fb;
  }
  const [minRes, maxRes] = await Promise.all([
    supabase.from('daily_seeds').select('date').eq('enabled', true).order('date', { ascending: true }).limit(1),
    supabase.from('daily_seeds').select('date').eq('enabled', true).order('date', { ascending: false }).limit(1),
  ]);
  if (!minRes.error && !maxRes.error && minRes.data?.[0] && maxRes.data?.[0]) {
    const meta = { anchor: minRes.data[0].date, end: maxRes.data[0].date };
    setSeedCache('dailyMeta', meta).catch(() => {});
    memoryCache.fetchedAt.dailyMeta = Date.now();
    return meta;
  }
  return { anchor: fallbackDaily?.anchor || null, windowYears: fallbackDaily?.windowYears || 0 };
}

export async function prefetch() {
  await Promise.all([getWinningPool(), getDailyMap()].map((p) => p.catch(() => null)));
}

export function clearMemoryCache() {
  memoryCache = { winning: null, daily: null, fetchedAt: {} };
}

export function _setMemoryCacheForTest(cache) {
  memoryCache = cache;
}
