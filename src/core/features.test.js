// core/features.test.js
// Validates the Daily Challenge + Special Events scaffolding: the pure
// generation helpers and the framework-agnostic loaders (with skeleton data).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  cyrb53,
  candidateGen,
  fillSeeds,
} from '../../scripts/lib/seedHelpers.mjs';
import { dailyDateList, buildUsedSet } from '../../scripts/generateDaily.mjs';
import { seedForDate, isDateBundled, listBundledDates, getDailyAnchor } from '../core/dailyChallenge.js';

test('cyrb53 is deterministic, 32-bit, and input-sensitive', () => {
  assert.equal(cyrb53('2024-01-01'), cyrb53('2024-01-01'));
  assert.ok(cyrb53('2024-01-01') >= 0 && cyrb53('2024-01-01') <= 0xffffffff);
  assert.notEqual(cyrb53('2024-01-01'), cyrb53('2024-01-02'));
});

test('candidateGen walks symmetrically', () => {
  // cap=5 means 4 ±-iterations after the base, yielding 9 values total.
  const g = candidateGen(100, 5);
  assert.deepEqual([...g], [100, 101, 99, 102, 98, 103, 97, 104, 96]);
});

test('fillSeeds returns the requested count of unique solvable seeds excluding used', () => {
  const initialUsed = new Set([12]);
  const used = new Set(initialUsed);
  const isSolvable = (seeds) => seeds.filter((s) => s % 2 === 0); // even == solvable
  const out = fillSeeds(10, 5, used, isSolvable, 1000);
  assert.equal(out.length, 5);
  assert.equal(new Set(out).size, 5);
  for (const s of out) {
    assert.equal(s % 2, 0);
    assert.ok(!initialUsed.has(s)); // pre-call exclusion respected
  }
  assert.ok(used.has(12)); // original member still present
});

test('dailyDateList spans a full year and is stable (UTC)', () => {
  const list = dailyDateList('2024-01-01', 1); // 2024 is a leap year
  assert.equal(list[0], '2024-01-01');
  assert.equal(list.length, 366);
  assert.equal(list[list.length - 1], '2024-12-31');

  const list2 = dailyDateList('2023-01-01', 1); // common year
  assert.equal(list2.length, 365);
});

test('buildUsedSet aggregates pool + daily without throwing on missing files', () => {
  const used = buildUsedSet();
  assert.ok(used instanceof Set);
});

test('daily loader reflects the bundled data file', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = JSON.parse(readFileSync(join(here, '../data/dailyChallenge.json'), 'utf8'));
  assert.equal(getDailyAnchor(), file.anchor);
  const dates = Object.keys(file.seeds || {}).sort();
  assert.deepEqual(listBundledDates(), dates);
  if (dates.length > 0) {
    assert.equal(seedForDate(dates[0]), file.seeds[dates[0]]);
    assert.equal(isDateBundled(dates[0]), true);
  }
  assert.equal(isDateBundled('2099-01-01'), false);
});

test('winning pool is internally unique and disjoint from daily + event seeds', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..');

  const pool = JSON.parse(readFileSync(join(root, 'src/data/solvableSeeds.json'), 'utf8'));
  const daily = JSON.parse(readFileSync(join(root, 'src/data/dailyChallenge.json'), 'utf8'));
  assert.ok(Array.isArray(pool) && pool.length > 0, 'winning pool must be non-empty');

  const poolNums = pool.map((s) => s >>> 0);
  assert.equal(new Set(poolNums).size, poolNums.length, 'winning pool contains duplicates');
  for (const s of poolNums) {
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff, `winning seed out of uint32 range: ${s}`);
  }

  const dailySeeds = Object.values((daily && daily.seeds) || {}).map((s) => s >>> 0);
  const dailySet = new Set(dailySeeds);
  assert.equal(dailySet.size, dailySeeds.length, 'daily pool contains duplicates');

  const sqlPath = join(root, 'scripts/eventSeeds.sql');
  const eventSeeds = [];
  if (existsSync(sqlPath)) {
    const sql = readFileSync(sqlPath, 'utf8');
    const seedRegex = /unnest\(array\[([^\]]+)\]::bigint\[\]\)/g;
    let m;
    while ((m = seedRegex.exec(sql)) !== null) {
      for (const tok of m[1].split(',')) {
        const n = Number(tok.trim());
        if (Number.isInteger(n)) eventSeeds.push(n >>> 0);
      }
    }
  }
  const eventSet = new Set(eventSeeds);

  const poolSet = new Set(poolNums);
  for (const s of dailySeeds) {
    assert.ok(!poolSet.has(s), `seed ${s} appears in both winning and daily pools`);
  }
  for (const s of eventSeeds) {
    assert.ok(!poolSet.has(s), `seed ${s} appears in both winning and event pools`);
    assert.ok(!dailySet.has(s), `seed ${s} appears in both event and daily pools`);
  }
  assert.equal(eventSet.size, eventSeeds.length, 'eventSeeds.sql contains duplicate seeds');
});
