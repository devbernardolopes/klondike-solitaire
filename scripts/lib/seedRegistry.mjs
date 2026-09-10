// scripts/lib/seedRegistry.mjs
//
// Single source of truth for cross-mode seed uniqueness (local files only).
//
// Reads:
//   - src/data/solvableSeeds.json        (winning pool, array of uint32)
//   - src/data/dailyChallenge.json       (daily map, { seeds: { date: uint32 } })
//   - scripts/eventSeeds.sql             (special events, unnest(...::bigint[]) arrays)
//
// Uniqueness comes from exclusion, not ranges: every generator builds its
// `used` set from here, so run order no longer matters.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DEFAULT_POOL_PATH = join(ROOT, 'src', 'data', 'solvableSeeds.json');
const DEFAULT_DAILY_PATH = join(ROOT, 'src', 'data', 'dailyChallenge.json');
const DEFAULT_EVENT_SQL_PATH = join(ROOT, 'scripts', 'eventSeeds.sql');

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function readEventSeeds(sqlPath) {
  if (!existsSync(sqlPath)) return [];
  const sql = readFileSync(sqlPath, 'utf8');
  const out = [];
  const seedRegex = /unnest\(array\[([^\]]+)\]::bigint\[\]\)/g;
  let m;
  while ((m = seedRegex.exec(sql)) !== null) {
    for (const tok of m[1].split(',')) {
      const n = Number(tok.trim());
      if (Number.isInteger(n)) out.push(n >>> 0);
    }
  }
  return out;
}

// Build the global exclusion set: every seed reserved by any mode.
// Deterministic; missing files contribute nothing (offline-friendly).
export function buildGlobalUsedSet({
  poolPath = DEFAULT_POOL_PATH,
  dailyPath = DEFAULT_DAILY_PATH,
  eventSqlPath = DEFAULT_EVENT_SQL_PATH,
} = {}) {
  const used = new Set();
  let winning = 0;
  let daily = 0;
  let events = 0;

  const pool = loadJson(poolPath, []);
  if (Array.isArray(pool)) {
    for (const v of pool) {
      if (typeof v === 'number' && Number.isInteger(v)) {
        used.add(v >>> 0);
        winning++;
      }
    }
  }

  const dailyDoc = loadJson(dailyPath, null);
  const seeds = (dailyDoc && dailyDoc.seeds) || {};
  for (const k of Object.keys(seeds)) {
    const v = seeds[k];
    if (typeof v === 'number' && Number.isInteger(v)) {
      used.add(v >>> 0);
      daily++;
    }
  }

  for (const s of readEventSeeds(eventSqlPath)) {
    used.add(s);
    events++;
  }

  return { used, counts: { winning, daily, events } };
}

// List every seed claimed by more than one mode.
// Returns [{ seed, where: ['winning','daily',...] }].
export function findOverlaps({
  poolPath = DEFAULT_POOL_PATH,
  dailyPath = DEFAULT_DAILY_PATH,
  eventSqlPath = DEFAULT_EVENT_SQL_PATH,
} = {}) {
  const owners = new Map(); // seed -> Set<owner>
  const claim = (seed, owner) => {
    if (!owners.has(seed)) owners.set(seed, new Set());
    owners.get(seed).add(owner);
  };

  const pool = loadJson(poolPath, []);
  if (Array.isArray(pool)) {
    for (const v of pool) {
      if (typeof v === 'number' && Number.isInteger(v)) claim(v >>> 0, 'winning');
    }
  }

  const dailyDoc = loadJson(dailyPath, null);
  const seeds = (dailyDoc && dailyDoc.seeds) || {};
  for (const k of Object.keys(seeds)) {
    const v = seeds[k];
    if (typeof v === 'number' && Number.isInteger(v)) claim(v >>> 0, `daily:${k}`);
  }

  if (existsSync(eventSqlPath)) {
    const sql = readFileSync(eventSqlPath, 'utf8');
    const dealRegex = /insert into special_event_deals\b([\s\S]*?)where event_id = '([^']+)' and page_number = (\d+);/gi;
    const seedHeader = /unnest\(array\[([^\]]+)\]::bigint\[\]\)/i;
    let m;
    let blocks = 0;
    while ((m = dealRegex.exec(sql)) !== null) {
      blocks++;
      const body = m[1];
      const eventId = m[2];
      const pageNum = m[3];
      const match = seedHeader.exec(body);
      if (!match) continue;
      for (const tok of match[1].split(',')) {
        const n = Number(tok.trim());
        if (Number.isInteger(n)) claim(n >>> 0, `event:${eventId}:p${pageNum}`);
      }
    }
    // Fallback: SQL without per-page WHERE blocks (e.g. hand-written fixtures).
    if (blocks === 0) {
      let i = 0;
      for (const s of readEventSeeds(eventSqlPath)) claim(s, `event:sql:${i++}`);
    }
  }

  const overlaps = [];
  for (const [seed, set] of owners) {
    const modes = new Set([...set].map((o) => o.split(':')[0]));
    if (modes.size > 1) overlaps.push({ seed, where: [...set].sort() });
  }
  overlaps.sort((a, b) => a.seed - b.seed);
  return overlaps;
}

export { DEFAULT_POOL_PATH, DEFAULT_DAILY_PATH, DEFAULT_EVENT_SQL_PATH };
