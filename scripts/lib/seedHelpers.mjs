// scripts/lib/seedHelpers.mjs
//
// Shared solver plumbing for offline seed-generation scripts (daily
// challenge, special events). Pure computational helpers — no file-path
// constants, no generation orchestration, no main().
//
// Imported by: generateDaily.mjs, generateEventSeeds.mjs,
//              core/features.test.js (via the individual scripts)
//

import { readFileSync, existsSync } from 'node:fs';
import { solveWithJs, solveWithBinary } from '../generateSolvablePool.mjs';

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
export function solveBatch(seeds, binary) {
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

// ---- Filesystem helper ----------------------------------------------------

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export { loadJson };
