// scripts/generateDaily.mjs
//
// Generate Daily Challenge seeds as pre-verified, globally UNIQUE solvable
// seeds, excluding the winning-deal pool. Reuses the real solver plumbing
// from generateSolvablePool.mjs so verdicts match the actual game (draw-1
// Klondike).
//
//   node scripts/generateDaily.mjs            # full run -> src/data/dailyChallenge.json
//   node scripts/generateDaily.mjs --smoke    # stub solver, temp dir, self-validate
//
// Env: SOLVER_PATH (or a KlondikeSolver binary on PATH) selects the fast binary
// path; otherwise the embedded pure-JS solver is used (correct but slow).

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { findSolverBinary } from './generateSolvablePool.mjs';
import { cyrb53, fillSeeds, solveBatch } from './lib/seedHelpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');
const DAILY_PATH = join(DATA_DIR, 'dailyChallenge.json');
const POOL_PATH = join(DATA_DIR, 'solvableSeeds.json');
const DAILY_META = join(DATA_DIR, 'dailyChallenge.meta.json');

const ANCHOR = process.env.DAILY_ANCHOR || '2026-01-01';
const WINDOW_YEARS = Number(process.env.DAILY_WINDOW_YEARS || 5);

// ---- Daily-specific helpers (exported for unit testing) ---------------------

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

// Build the global exclusion set from pool + existing daily seeds.
export function buildUsedSet({ poolPath = POOL_PATH, dailyPath = DAILY_PATH } = {}) {
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
  return used;
}

// ---- Core generation routine ------------------------------------------------

function runGeneration({ used, solveFn, outDir, anchor, windowYears, dailyLimit = Infinity }) {
  const dates = dailyDateList(anchor, windowYears).slice(0, dailyLimit);
  const dailySeeds = {};
  for (const date of dates) {
    const [s] = fillSeeds(cyrb53(date), 1, used, solveFn);
    dailySeeds[date] = s;
  }

  const dailyDoc = { anchor, windowYears, seeds: dailySeeds };
  const writeToDataDir = outDir === DATA_DIR;
  writeFileSync(join(outDir, 'dailyChallenge.json'), JSON.stringify(dailyDoc) + '\n');
  if (writeToDataDir) {
    writeFileSync(
      DAILY_META,
      JSON.stringify({ anchor, windowYears, generatedAt: new Date().toISOString(), count: dates.length }) + '\n',
    );
  }
  return { dailyDoc };
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
    const tmp = join(DATA_DIR, '.smoke-daily');
    mkdirSync(tmp, { recursive: true });
    // Stub solver: deterministic ~33% solvable subset, so we exercise the whole
    // pipeline (hash → walk → fill → write → uniqueness check) without the cost
    // of the real solver.
    const used = new Set();
    const stubSolve = (seeds) => seeds.filter((s) => s % 3 === 0);
    const { dailyDoc } = runGeneration({
      used,
      solveFn: stubSolve,
      outDir: tmp,
      anchor: ANCHOR,
      windowYears: 1,
      dailyLimit: 3,
    });
    const all = Object.values(dailyDoc.seeds);
    const uniq = new Set(all);
    if (uniq.size !== all.length) throw new Error('SMOKE FAIL: duplicate seeds generated');
    for (const s of all) if (s % 3 !== 0) throw new Error('SMOKE FAIL: non-solvable seed admitted');
    console.log(`SMOKE OK: ${Object.keys(dailyDoc.seeds).length} daily seeds, all unique & solvable.`);
    return;
  }

  const used = buildUsedSet();
  const target = outDir || DATA_DIR;
  runGeneration({
    used,
    solveFn,
    outDir: target,
    anchor: ANCHOR,
    windowYears: WINDOW_YEARS,
    dailyLimit: dailyLimit ? Number(dailyLimit) : Infinity,
  });
  console.log(`Done. Daily seeds written to ${target}/.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { runGeneration };
