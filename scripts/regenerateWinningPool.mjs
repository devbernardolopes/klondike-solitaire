// scripts/regenerateWinningPool.mjs
//
// Regenerate the Winning-Deal pool (`src/data/solvableSeeds.json`) in the full
// uint32 seed space — the same format Daily/Event/Random deals already use —
// replacing the legacy small sequential ints (0..50000 scan).
//
// Uniqueness comes from exclusion, not ranges: the new pool is solver-verified
// via the shared `seedHelpers.mjs` plumbing and excludes every Daily + Special
// Event seed. Random-Shuffle deals exclude the pool at runtime
// (`core/randomSeed.js` + `useGameStore.dealNewGame`), so no Random history is
// needed here.
//
// Usage:
//   npm run winning:regenerate -- --dry-run [--count N]
//   npm run winning:regenerate -- --count 2000 --wipe-game-data [--force]
//   node scripts/regenerateWinningPool.mjs --help
//
// Env (required unless --skip-db or --dry-run):
//   SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
//   SOLVER_PATH (optional) — KlondikeSolver binary for the fast path;
//     otherwise the embedded pure-JS fallback solver is used (correct but slow
//     for large counts — smoke-test with --count 50 first).

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

import { findSolverBinary } from './generateSolvablePool.mjs';
import { cyrb53, fillSeeds, solveBatch, loadJson } from './lib/seedHelpers.mjs';
import { parseExistingDeals } from './generateEventSeeds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'src', 'data');
const POOL_PATH = join(DATA_DIR, 'solvableSeeds.json');
const META_PATH = join(DATA_DIR, 'solvableSeeds.meta.json');
const DAILY_PATH = join(DATA_DIR, 'dailyChallenge.json');
const EVENT_SQL_PATH = join(__dirname, 'eventSeeds.sql');

const DEFAULT_COUNT = 2000;
const DEFAULT_BASE_LABEL = 'winning-pool-v2';
const U32_MAX = 0xffffffff;

// ---- Args ----

function parseArgs(argv) {
  const opts = {
    count: DEFAULT_COUNT,
    baseLabel: DEFAULT_BASE_LABEL,
    dryRun: false,
    skipDb: false,
    wipeGameData: false,
    force: false,
    nonInteractive: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--skip-db') opts.skipDb = true;
    else if (a === '--wipe-game-data') opts.wipeGameData = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--non-interactive') opts.nonInteractive = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--count') {
      const v = argv[++i];
      if (v === undefined) throw new Error('--count requires a value');
      opts.count = Number(v);
    } else if (a === '--base-label') {
      const v = argv[++i];
      if (v === undefined) throw new Error('--base-label requires a value');
      opts.baseLabel = v;
    } else {
      throw new Error(`Unknown argument: ${a} (see --help)`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`regenerateWinningPool.mjs — regenerate the Winning-Deal pool in uint32 space.

Usage:
  node scripts/regenerateWinningPool.mjs [flags]
  npm run winning:regenerate -- [flags]

Flags:
  --count <n>            Pool size (default: ${DEFAULT_COUNT})
  --base-label <text>    Hash label for the deterministic walk (default: ${DEFAULT_BASE_LABEL})
  --dry-run              Generate in memory, validate, print plan; write nothing, touch no DB
  --skip-db              Write JSON files only, skip all Supabase work
  --wipe-game-data       Also DELETE game_sessions, game_results, played_seeds
                         (old small-seed history becomes orphaned by the swap)
  --force                Skip the wipe confirmation prompt
  --non-interactive      Error instead of prompting (requires --force with --wipe-game-data)
  --help, -h             This text

Env (required unless --skip-db or --dry-run):
  SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
  SOLVER_PATH (optional) — KlondikeSolver binary, else slow JS fallback.

Sequence: exclusion set (daily + events) -> solver-verified fill -> validate
  -> write JSON + meta -> version bump -> wipe (opt-in) -> replace winning_seeds
  -> test run.`);
}

// ---- Exclusion set (daily + events; old pool deliberately excluded) ----

function buildExclusionSet() {
  const used = new Set();
  let dailyCount = 0;
  let eventCount = 0;
  const daily = loadJson(DAILY_PATH, null);
  const seeds = (daily && daily.seeds) || {};
  for (const k of Object.keys(seeds)) {
    const v = seeds[k];
    if (typeof v === 'number') {
      used.add(v >>> 0);
      dailyCount++;
    }
  }
  if (existsSync(EVENT_SQL_PATH)) {
    const parsed = parseExistingDeals(readFileSync(EVENT_SQL_PATH, 'utf8'));
    for (const s of parsed.usedSeeds) {
      used.add(s >>> 0);
      eventCount++;
    }
  }
  return { used, dailyCount, eventCount };
}

function bumpPatchVersion(version) {
  const parts = String(version).split('.').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
    throw new Error(`Cannot bump version "${version}": expected semver x.y.z`);
  }
  parts[2] += 1;
  return parts.join('.');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }
  if (!Number.isInteger(opts.count) || opts.count < 1) {
    throw new Error(`--count must be an integer >= 1, got "${opts.count}"`);
  }
  if (!opts.baseLabel || typeof opts.baseLabel !== 'string') {
    throw new Error('--base-label must be a non-empty string');
  }
  if (opts.wipeGameData && opts.nonInteractive && !opts.force) {
    throw new Error('--wipe-game-data with --non-interactive requires --force');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const { used, dailyCount, eventCount } = buildExclusionSet();
    console.error(`Exclusion set: ${used.size} seeds (${dailyCount} daily, ${eventCount} events). Old pool ignored by design.`);
    if (!existsSync(EVENT_SQL_PATH)) {
      console.error('Warning: scripts/eventSeeds.sql not found — event exclusion skipped.');
    }

    const binary = findSolverBinary();
    console.error(binary
      ? `Solver binary found: ${binary}`
      : 'No solver binary — embedded JS fallback (slow for large counts; try --count 50 first).');

    const base = cyrb53(opts.baseLabel);
    console.error(`Generating ${opts.count} solvable uint32 seeds from base ${base} ("${opts.baseLabel}")...`);
    const solveFn = (seeds) => solveBatch(seeds, binary);
    const seeds = fillSeeds(base, opts.count, new Set(used), solveFn).map((s) => s >>> 0);
    seeds.sort((a, b) => a - b);

    // --- Validate ---
    if (new Set(seeds).size !== seeds.length) throw new Error('Validation failed: duplicate seeds generated');
    for (const s of seeds) {
      if (!Number.isInteger(s) || s < 0 || s > U32_MAX) throw new Error(`Validation failed: seed out of uint32 range: ${s}`);
      if (used.has(s)) throw new Error(`Validation failed: seed ${s} collides with daily/event pool`);
    }
    console.error(`Validated: ${seeds.length} unique uint32 seeds, solvable, no daily/event overlap.`);

    if (opts.dryRun) {
      console.log(`Dry run — no writes. Plan:`);
      console.log(`  pool: ${seeds.length} seeds, range ${seeds[0]}..${seeds[seeds.length - 1]}`);
      console.log(`  sample: ${seeds.slice(0, 5).join(', ')}`);
      console.log(`  would write: src/data/solvableSeeds.json + solvableSeeds.meta.json, package.json bump`);
      console.log(opts.wipeGameData
        ? `  would wipe: game_sessions, game_results, played_seeds; then replace winning_seeds`
        : `  would replace: winning_seeds (no game-data wipe — pass --wipe-game-data to clear orphans)`);
      return;
    }

    writeFileSync(POOL_PATH, JSON.stringify(seeds) + '\n');
    console.error(`Pool written: ${POOL_PATH} (${seeds.length} seeds)`);
    writeFileSync(META_PATH, JSON.stringify({
      mode: 'uint32-v2',
      baseLabel: opts.baseLabel,
      base,
      count: seeds.length,
      generatedAt: new Date().toISOString(),
      solver: binary ? `binary (${binary})` : 'embedded-js-fallback',
    }) + '\n');
    console.error(`Meta written: ${META_PATH}`);

    const pkgPath = join(ROOT, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkg.version = bumpPatchVersion(pkg.version);
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.error(`Version bumped: ${pkg.version}`);

    if (opts.skipDb) {
      console.error('Skipping Supabase (--skip-db). Run pushSeeds.mjs --winning-only later to upload.');
    } else {
      const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !serviceKey) {
        throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY in env (or use --skip-db / --dry-run)');
      }
      if (opts.wipeGameData && !opts.force) {
        if (opts.nonInteractive) throw new Error('Unreachable: non-interactive wipe requires --force');
        const ans = (await rl.question('Type YES to DELETE game_sessions, game_results, played_seeds, winning_seeds: ')).trim();
        if (ans !== 'YES') throw new Error('Aborted: confirmation not received');
      }
      const supabase = createClient(url, serviceKey);
      if (opts.wipeGameData) {
        // Per-table always-true filters (supabase-js blocks unfiltered deletes).
        const wipes = [
          ['game_sessions', (q) => q.neq('device_id', '')],
          ['game_results', (q) => q.gte('moves', 0)],
          ['played_seeds', (q) => q.neq('seed', -1)],
          ['winning_seeds', (q) => q.neq('seed', -1)],
        ];
        for (const [table, filter] of wipes) {
          const { error } = await filter(supabase.from(table).delete());
          if (error) throw new Error(`${table} wipe failed: ${error.message}`);
          console.error(`Wiped: ${table}`);
        }
      } else {
        const { error } = await supabase.from('winning_seeds').delete().neq('seed', -1);
        if (error) throw new Error(`winning_seeds clear failed: ${error.message}`);
        console.error('Cleared: winning_seeds (game history left intact — old seeds are now orphans)');
      }
      const rows = seeds.map((seed, i) => ({ seed, enabled: true, sort_order: i }));
      let upserted = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from('winning_seeds').upsert(rows.slice(i, i + 500), { onConflict: 'seed' });
        if (error) throw new Error(`winning_seeds upsert failed: ${error.message}`);
        upserted += Math.min(500, rows.length - i);
      }
      console.error(`Upserted: ${upserted} into winning_seeds`);
    }

    try {
      execFileSync('node', ['--test', 'src/core/features.test.js'], { cwd: ROOT, stdio: 'pipe' });
      console.error('Tests passed: src/core/features.test.js');
    } catch {
      console.error('Warning: src/core/features.test.js failed — run it manually and inspect.');
    }

    console.log(`Done. Winning pool: ${seeds.length} uint32 seeds, version ${JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version}.`);
    console.log(`Suggested commit: feat(winning): regenerate pool in uint32 space (${seeds.length} seeds)`);
  } finally {
    rl.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? `Error: ${e.message}` : e);
    process.exit(1);
  });
}

export { parseArgs, buildExclusionSet };
