// scripts/generateFeatures.mjs
//
// Generate Daily Challenge + Special Event seeds as pre-verified, globally
// UNIQUE solvable seeds. Reuses the real solver plumbing from
// generateSolvablePool.mjs so verdicts match the actual game (draw-1 Klondike).
//
//   node scripts/generateFeatures.mjs            # full run -> src/data/*
//   node scripts/generateFeatures.mjs --smoke    # stub solver, temp dir, self-validate
//
// Env: SOLVER_PATH (or a KlondikeSolver binary on PATH) selects the fast binary
// path; otherwise the embedded pure-JS solver is used (correct but slow).
//
// Guarantees:
//  - Every produced seed is solver-confirmed solvable (no false positives).
//  - No seed is ever reused across the pool, daily, and event feature groups
//    (a shared `used` set spans all three sources).
//  - Events are generated incrementally: a re-run only fills events whose id is
//    in eventCatalog.json but lacks 50 seeds, so existing seeds stay stable.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { solveWithJs, solveWithBinary, findSolverBinary } from './generateSolvablePool.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');
const DAILY_PATH = join(DATA_DIR, 'dailyChallenge.json');
const EVENTS_PATH = join(DATA_DIR, 'specialEvents.json');
const POOL_PATH = join(DATA_DIR, 'solvableSeeds.json');
const DAILY_META = join(DATA_DIR, 'dailyChallenge.meta.json');
const EVENTS_META = join(DATA_DIR, 'specialEvents.meta.json');

const SEEDS_PER_EVENT = 50;
const ANCHOR = process.env.DAILY_ANCHOR || '2026-01-01';
const WINDOW_YEARS = Number(process.env.DAILY_WINDOW_YEARS || 5);

// ---- Pure helpers (exported for unit testing) ------------------------------

// cyrb53 — fast, portable, synchronous string hash → 32-bit unsigned int.
export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const full = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return full >>> 0;
}

// Deterministic candidate walk around a base: base, +1, -1, +2, -2, ...
export function* candidateGen(base, cap = 500000) {
  yield base >>> 0;
  for (let k = 1; k < cap; k++) {
    yield (base + k) >>> 0;
    yield (base - k) >>> 0;
  }
}

// Batch-solve an array of seeds. Uses the binary fast path when available,
// otherwise the embedded JS solver. Returns the solvable subset.
function solveBatch(seeds, binary) {
  if (seeds.length === 0) return [];
  if (binary) {
    const out = [];
    for (let i = 0; i < seeds.length; i += 200) {
      out.push(...solveWithBinary(seeds.slice(i, i + 200)));
    }
    return out;
  }
  return seeds.filter((s) => solveWithJs(s));
}

// Fill `count` solver-confirmed-solvable seeds near `base`, excluding any seed
// already in `used` (a Set). Deterministic given `used`. Throws if it cannot
// find enough within `cap` candidates.
export function fillSeeds(base, count, used, solveFn, cap = 500000) {
  const out = [];
  const tried = new Set();
  // Solve in small batches when only a few seeds are needed (e.g. 1/day), but
  // keep the 200-candidate batch for the 50-seed events (efficient for the
  // binary fast path). Avoids solving hundreds of deals to find a single seed.
  const batchSize = Math.min(200, Math.max(count * 4, 8));
  let pending = [];
  const consume = () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    const solSet = new Set(solveFn(batch));
    for (const c of batch) {
      if (solSet.has(c) && !used.has(c)) {
        used.add(c);
        out.push(c);
        if (out.length >= count) break;
      }
    }
  };
  for (const c of candidateGen(base, cap)) {
    if (used.has(c) || tried.has(c)) continue;
    tried.add(c);
    pending.push(c);
    if (pending.length >= batchSize) consume();
    if (out.length >= count) break;
  }
  if (out.length < count) consume();
  if (out.length < count) {
    throw new Error(`fillSeeds: only found ${out.length}/${count} solvable near base ${base}`);
  }
  return out;
}

// List every calendar date (YYYY-MM-DD, UTC) in [anchor, anchor+windowYears).
export function dailyDateList(anchor, windowYears) {
  const [y, m, d] = anchor.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d);
  const end = Date.UTC(y + windowYears, m - 1, d);
  const out = [];
  for (let t = start; t < end; t += 86400000) {
    const dt = new Date(t);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    out.push(`${yy}-${mm}-${dd}`);
  }
  return out;
}

// Build the global exclusion set from pool + existing daily + existing events.
export function buildUsedSet({ poolPath = POOL_PATH, dailyPath = DAILY_PATH, eventsPath = EVENTS_PATH } = {}) {
  const used = new Set();
  const addAll = (path, pick) => {
    if (!existsSync(path)) return;
    try {
      const doc = JSON.parse(readFileSync(path, 'utf8'));
      for (const v of pick(doc)) used.add(v);
    } catch {
      /* ignore malformed files */
    }
  };
  addAll(poolPath, (d) => (Array.isArray(d) ? d : []));
  addAll(dailyPath, (d) => Object.values((d && d.seeds) || {}));
  addAll(eventsPath, (d) => ((d && d.events) || []).flatMap((e) => e.seeds || []));
  return used;
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

// ---- Core generation routine ------------------------------------------------

function runGeneration({ used, solveFn, binary, outDir, anchor, windowYears, catalog, dailyLimit = Infinity, eventLimit = Infinity }) {
  const dates = dailyDateList(anchor, windowYears).slice(0, dailyLimit);
  const dailySeeds = {};
  for (const date of dates) {
    const [s] = fillSeeds(cyrb53(date), 1, used, solveFn);
    dailySeeds[date] = s;
  }

  const existingEvents = loadJson(join(outDir, 'specialEvents.json'), { events: [] }).events || [];
  const existingById = new Map(existingEvents.map((e) => [e.id, e]));
  const events = [];
  for (const ev of catalog.slice(0, eventLimit)) {
    const ex = existingById.get(ev.id);
    if (ex && Array.isArray(ex.seeds) && ex.seeds.length >= SEEDS_PER_EVENT) {
      for (const s of ex.seeds) used.add(s);
      events.push(ex);
      continue;
    }
    const seeds = fillSeeds(cyrb53(ev.id), SEEDS_PER_EVENT, used, solveFn);
    events.push({ id: ev.id, seeds });
  }

  const dailyDoc = { anchor, windowYears, seeds: dailySeeds };
  const eventsDoc = { events };
  const writeToDataDir = outDir === DATA_DIR;
  writeFileSync(join(outDir, 'dailyChallenge.json'), JSON.stringify(dailyDoc) + '\n');
  writeFileSync(join(outDir, 'specialEvents.json'), JSON.stringify(eventsDoc) + '\n');
  if (writeToDataDir) {
    writeFileSync(
      DAILY_META,
      JSON.stringify({ anchor, windowYears, generatedAt: new Date().toISOString(), count: dates.length }) + '\n',
    );
    writeFileSync(
      EVENTS_META,
      JSON.stringify({ generatedAt: new Date().toISOString(), count: events.length, eventIds: events.map((e) => e.id) }) + '\n',
    );
  }
  return { dailyDoc, eventsDoc };
}

// ---- Entry points -----------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const getFlag = (name) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : null;
  };
  const smoke = args.includes('--smoke');
  const dailyLimit = getFlag('--daily-limit');
  const outDir = getFlag('--out');
  const binary = findSolverBinary();
  const solveFn = (seeds) => solveBatch(seeds, binary);

  if (smoke) {
    const tmp = join(DATA_DIR, '.smoke-features');
    mkdirSync(tmp, { recursive: true });
    // Stub solver: deterministic ~33% solvable subset, so we exercise the whole
    // pipeline (hash → walk → fill → write → uniqueness check) without the cost
    // of the real solver.
    const used = new Set();
    const stubSolve = (seeds) => seeds.filter((s) => s % 3 === 0);
    const catalog = [{ id: 'smoke-event', title: 'Smoke Event', images: [] }];
    const { dailyDoc, eventsDoc } = runGeneration({
      used,
      solveFn: stubSolve,
      binary: null,
      outDir: tmp,
      anchor: ANCHOR,
      windowYears: 1,
      catalog,
      dailyLimit: 3,
      eventLimit: 1,
    });
    const all = [...Object.values(dailyDoc.seeds), ...eventsDoc.events.flatMap((e) => e.seeds)];
    const uniq = new Set(all);
    if (uniq.size !== all.length) throw new Error('SMOKE FAIL: duplicate seeds generated');
    if (eventsDoc.events[0].seeds.length !== SEEDS_PER_EVENT) throw new Error('SMOKE FAIL: wrong event seed count');
    for (const s of all) if (s % 3 !== 0) throw new Error('SMOKE FAIL: non-solvable seed admitted');
    console.log(
      `SMOKE OK: ${Object.keys(dailyDoc.seeds).length} daily + ${eventsDoc.events.length} event (${eventsDoc.events[0].seeds.length} seeds), all unique & solvable.`,
    );
    return;
  }

  const used = buildUsedSet();
  const catalog = (loadJson(join(DATA_DIR, 'eventCatalog.json'), { events: [] }).events) || [];
  const target = outDir || DATA_DIR;
  runGeneration({
    used,
    solveFn,
    binary,
    outDir: target,
    anchor: ANCHOR,
    windowYears: WINDOW_YEARS,
    catalog,
    dailyLimit: dailyLimit ? Number(dailyLimit) : Infinity,
  });
  console.log(`Done. Daily + Special Event seeds written to ${target}/.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { SEEDS_PER_EVENT, runGeneration, solveBatch };
