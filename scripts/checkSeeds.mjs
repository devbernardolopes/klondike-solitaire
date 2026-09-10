// scripts/checkSeeds.mjs
//
// Blocking cross-mode uniqueness check (local files only).
// Fails (exit 1) when any seed appears in more than one mode, or when any
// single pool contains internal duplicates.
//
//   node scripts/checkSeeds.mjs
//   npm run seeds:check
//

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findOverlaps, buildGlobalUsedSet } from './lib/seedRegistry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function internalDuplicates(arr) {
  const seen = new Set();
  const dupes = new Set();
  for (const s of arr) {
    if (seen.has(s)) dupes.add(s);
    seen.add(s);
  }
  return [...dupes].sort((a, b) => a - b);
}

function main() {
  const poolPath = join(ROOT, 'src', 'data', 'solvableSeeds.json');
  const dailyPath = join(ROOT, 'src', 'data', 'dailyChallenge.json');
  const eventSqlPath = join(ROOT, 'scripts', 'eventSeeds.sql');

  let pool = [];
  try {
    if (existsSync(poolPath)) {
      const raw = JSON.parse(readFileSync(poolPath, 'utf8'));
      if (Array.isArray(raw)) pool = raw.map((s) => s >>> 0);
    }
  } catch { /* treated as empty; overlap check below still runs */ }

  let dailySeeds = [];
  try {
    if (existsSync(dailyPath)) {
      const doc = JSON.parse(readFileSync(dailyPath, 'utf8'));
      dailySeeds = Object.values((doc && doc.seeds) || {}).map((s) => s >>> 0);
    }
  } catch { /* treated as empty */ }

  const { counts } = buildGlobalUsedSet({ poolPath, dailyPath, eventSqlPath });
  console.log(`winning: ${counts.winning}, daily: ${counts.daily}, events: ${counts.events}`);

  let failed = false;

  for (const [name, arr] of [['winning', pool], ['daily', dailySeeds]]) {
    const dupes = internalDuplicates(arr);
    if (dupes.length > 0) {
      failed = true;
      console.error(`FAIL: ${name} pool has ${dupes.length} internal duplicate(s): ${dupes.slice(0, 10).join(', ')}${dupes.length > 10 ? '…' : ''}`);
    }
  }

  // Event internal duplicates are covered by the cross-mode overlap scan
  // (same seed twice within events claims one owner mode, so check explicitly).
  if (existsSync(eventSqlPath)) {
    const sql = readFileSync(eventSqlPath, 'utf8');
    const all = [];
    const re = /unnest\(array\[([^\]]+)\]::bigint\[\]\)/g;
    let m;
    while ((m = re.exec(sql)) !== null) {
      for (const tok of m[1].split(',')) {
        const n = Number(tok.trim());
        if (Number.isInteger(n)) all.push(n >>> 0);
      }
    }
    const dupes = internalDuplicates(all);
    if (dupes.length > 0) {
      failed = true;
      console.error(`FAIL: events SQL has ${dupes.length} internal duplicate(s): ${dupes.slice(0, 10).join(', ')}${dupes.length > 10 ? '…' : ''}`);
    }
  }

  const overlaps = findOverlaps({ poolPath, dailyPath, eventSqlPath });
  if (overlaps.length > 0) {
    failed = true;
    console.error(`FAIL: ${overlaps.length} seed(s) shared across modes:`);
    for (const o of overlaps.slice(0, 20)) {
      console.error(`  ${o.seed} ← ${o.where.join(', ')}`);
    }
    if (overlaps.length > 20) console.error(`  …and ${overlaps.length - 20} more`);
  }

  if (failed) {
    console.error('seeds:check FAILED');
    process.exit(1);
  }
  console.log('seeds:check OK — all pools internally unique and disjoint across modes.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { main };
