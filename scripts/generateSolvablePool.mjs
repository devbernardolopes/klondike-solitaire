// scripts/generateSolvablePool.mjs
//
// ⚠️ NOT part of `npm run dev` / `npm run build`. This is a manual maintenance
// script to (re)generate `src/data/solvableSeeds.json` — a static, pre-verified
// pool of solvable game seeds the app bundles. Run it occasionally to grow the
// pool:
//
//     node scripts/generateSolvablePool.mjs
//
// It requires the `KlondikeSolver` binary (ShootMe/Klondike-Solver) for the fast
// path. Point it at the binary via the `SOLVER_PATH` env var, or have it on
// `PATH`. When the binary is NOT available, it falls back to an embedded,
// self-contained pure-JS solver that reuses the REAL core move engine (so its
// verdicts are faithful to the actual game). The JS fallback only marks a seed
// "solvable" when it has actually reached a full win, so the committed pool
// never contains false positives — it may miss some solvable deals (false
// negatives), but those are simply skipped.
//
// Supports RESUME: it remembers how far it has scanned in
// `src/data/solvableSeeds.meta.json` and continues from there on the next run,
// so you can grow the pool across multiple invocations.

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildStandardDeck, shuffle } from '../src/core/Deck.js';
import { deal } from '../src/core/dealer.js';
import { canMoveToTableau, canMoveToFoundation, getTableauRun, DEST_ORDER } from '../src/core/rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');
const POOL_PATH = join(DATA_DIR, 'solvableSeeds.json');
const META_PATH = join(DATA_DIR, 'solvableSeeds.meta.json');

// ---- Tunable constants -----------------------------------------------------
const SEED_RANGE_START = Number(process.env.SEED_RANGE_START ?? 0);
const SEED_RANGE_END = Number(process.env.SEED_RANGE_END ?? 50000); // scanning stops early once TARGET reached
const TARGET_POOL_SIZE = Number(process.env.TARGET_POOL_SIZE ?? 2000);
const STATE_CAP = Number(process.env.STATE_CAP ?? 4000); // max states explored per seed by the JS fallback
const OUT_PATH = process.env.OUT_PATH ?? POOL_PATH;
const SUIT_TO_DIGIT = { clubs: '1', diamonds: '2', hearts: '3', spades: '4' };

// ---- Seed pool persistence (resume support) --------------------------------
function loadPool() {
  return loadPoolFrom(POOL_PATH);
}

function loadPoolFrom(path) {
  if (!existsSync(path)) return [];
  try {
    const arr = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function loadScanCursor() {
  if (!existsSync(META_PATH)) return SEED_RANGE_START;
  try {
    const meta = JSON.parse(readFileSync(META_PATH, 'utf8'));
    return typeof meta.scannedUpTo === 'number' ? meta.scannedUpTo : SEED_RANGE_START;
  } catch {
    return SEED_RANGE_START;
  }
}

function saveProgress(pool, scannedUpTo) {
  writeFileSync(OUT_PATH, JSON.stringify([...new Set(pool)].sort((a, b) => a - b)) + '\n');
  if (OUT_PATH === POOL_PATH) {
    writeFileSync(META_PATH, JSON.stringify({ scannedUpTo }) + '\n');
  }
}

// ---- Binary (KlondikeSolver) fast path --------------------------------------
function findSolverBinary() {
  if (process.env.SOLVER_PATH && existsSync(process.env.SOLVER_PATH)) return process.env.SOLVER_PATH;
  try {
    return execFileSync('which', ['KlondikeSolver']).toString().trim() || null;
  } catch {
    return null;
  }
}

function encodeCard(card) {
  const r = String(card.rank).padStart(2, '0');
  return r + SUIT_TO_DIGIT[card.suit];
}

// The solver's deck string is the order cards are dealt (round-robin), which is
// exactly the post-shuffle deck order — so we encode the shuffled deck directly.
function deckStringForSeed(seed) {
  const deck = shuffle(buildStandardDeck(), seed);
  return deck.map(encodeCard).join('');
}

function solveWithBinary(seeds) {
  const tmp = join(DATA_DIR, '.deal-candidates.txt');
  writeFileSync(tmp, seeds.map(deckStringForSeed).join('\n') + '\n');
  const bin = findSolverBinary();
  const raw = execFileSync(bin, ['/FAST', '/OUT', '2', tmp], { maxBuffer: 1 << 28 }).toString();
  const lines = raw.split('\n');
  const solvable = [];
  let li = 0;
  for (let i = 0; i < seeds.length; i++) {
    // Advance to the next result line for game i.
    while (li < lines.length && !/Solved|Minimal|Impossible|Unknown/.test(lines[li])) li++;
    const line = lines[li] || '';
    li++;
    if (/Solved|Minimal solution/.test(line)) solvable.push(seeds[i]);
  }
  return solvable;
}

// ---- Fallback: embedded pure-JS solver reusing the real core rules ---------
// The *validity* checks delegate to the real core rules (canMoveToTableau,
// canMoveToFoundation, getTableauRun) so behaviour matches the game exactly.
// For speed, states are kept as compact integer-id arrays and transitions
// mirror core/moveEngine.js precisely (draw-1, reverse-recycle, auto-flip of an
// exposed tableau card). A seed is only declared solvable when a full win
// (all 52 cards in foundations) is actually reached — never a false positive.
const SUIT_NAMES = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANK = new Array(52);
const SUIT = new Array(52);
const IS_RED = new Array(52);
for (let id = 0; id < 52; id++) {
  const s = Math.floor(id / 13);
  RANK[id] = (id % 13) + 1;
  SUIT[id] = s;
  IS_RED[id] = s === 0 || s === 1; // hearts, diamonds
}
const cidOf = (rank, suit) => SUIT_NAMES.indexOf(suit) * 13 + (rank - 1);

function objOf(id) {
  return { id, rank: RANK[id], suit: SUIT_NAMES[SUIT[id]], faceUp: true, color: IS_RED[id] ? 'red' : 'black' };
}

// Convert a dealt GameState (from the real core/dealer.js) into the compact form.
function toCompact(state) {
  const up = new Uint8Array(52);
  const stock = state.stock.map((c) => cidOf(c.rank, c.suit));
  const waste = state.waste.map((c) => cidOf(c.rank, c.suit));
  const found = state.foundations.map((p) => p.map((c) => cidOf(c.rank, c.suit)));
  const tab = state.tableau.map((p) => p.map((c) => { const id = cidOf(c.rank, c.suit); up[id] = c.faceUp ? 1 : 0; return id; }));
  for (const c of waste) up[c] = 1;
  for (const f of found) for (const c of f) up[c] = 1;
  for (const c of stock) up[c] = 0;
  return { stock, waste, found, tab, up };
}

function cloneCompact(st) {
  return {
    stock: st.stock.slice(),
    waste: st.waste.slice(),
    found: st.found.map((a) => a.slice()),
    tab: st.tab.map((a) => a.slice()),
    up: st.up.slice(),
  };
}

function pileAtCompact(st, loc) {
  if (loc === 'stock') return st.stock;
  if (loc === 'waste') return st.waste;
  const [kind, idx] = loc.split(':');
  return kind === 'foundation' ? st.found[Number(idx)] : st.tab[Number(idx)];
}

function foundationTotal(st) {
  let n = 0;
  for (const f of st.found) n += f.length;
  return n;
}

function keyOf(st) {
  let s = st.stock.join(',') + '#' + st.waste.join(',') + '#';
  for (let i = 0; i < 4; i++) s += st.found[i].join('.') + '|';
  s += '#';
  for (let i = 0; i < 7; i++) {
    for (const id of st.tab[i]) s += id + (st.up[id] ? 'U' : 'D') + '.';
    s += '|';
  }
  return s;
}

// Generate every legal move from the compact state, using the real core rules.
// When `prune` is set (solver mode), pointless shuffles are dropped to keep the
// search small: foundation→tableau returns and tableau→empty-column relocations
// that expose nothing are excluded. This never creates a winning line that
// wouldn't exist otherwise — it only skips moves that can't be part of a
// shortest useful solution — so it cannot produce false positives.
function genMoves(st, prune = false) {
  const moves = [];

  // Tableau sources: any face-up card can lift the valid run beneath it.
  for (let i = 0; i < 7; i++) {
    const pile = st.tab[i];
    if (pile.length === 0) continue;
    const pobjs = pile.map((id) => ({ id, rank: RANK[id], suit: SUIT_NAMES[SUIT[id]], faceUp: !!st.up[id] }));
    for (let j = 0; j < pile.length; j++) {
      if (!st.up[pile[j]]) continue;
      const run = getTableauRun(pobjs, pile[j]);
      if (!run) continue;
      const movingCard = run[0];
      const from = `tableau:${i}`;
      for (const loc of DEST_ORDER) {
        if (loc === from) continue;
        const dest = pileAtCompact(st, loc);
        if (!dest) continue;
        const dobjs = dest.map((id) => ({ id, rank: RANK[id], suit: SUIT_NAMES[SUIT[id]], faceUp: !!st.up[id] }));
        const valid = loc.startsWith('foundation')
          ? run.length === 1 && canMoveToFoundation(movingCard, dobjs)
          : canMoveToTableau(movingCard, dobjs);
        if (!valid) continue;
        // Prune: relocating a whole run onto an empty column exposes nothing.
        if (prune && !loc.startsWith('foundation') && dest.length === 0) {
          if (j === 0) continue; // entire column moved to empty — pointless
    if (st.up[pile[j - 1]]) continue; // nothing new exposed beneath
        }
        moves.push({ type: 'moveCards', from, to: loc, j });
      }
    }
  }

  // Waste source: single top card.
  if (st.waste.length > 0) {
    const cid = st.waste[st.waste.length - 1];
    const card = objOf(cid);
    const from = 'waste';
    for (const loc of DEST_ORDER) {
      if (loc === from) continue;
      const dest = pileAtCompact(st, loc);
      if (!dest) continue;
      const dobjs = dest.map((id) => ({ id, rank: RANK[id], suit: SUIT_NAMES[SUIT[id]], faceUp: !!st.up[id] }));
      const valid = loc.startsWith('foundation')
        ? canMoveToFoundation(card, dobjs)
        : canMoveToTableau(card, dobjs);
      if (!valid) continue;
      if (prune && !loc.startsWith('foundation') && dest.length === 0 && card.rank !== 13) continue;
      moves.push({ type: 'moveCards', from, to: loc });
    }
  }

  // Foundation sources: a top card may return to a tableau (never foundation→foundation).
  if (!prune) {
    for (let i = 0; i < 4; i++) {
      const pile = st.found[i];
      if (pile.length === 0) continue;
      const card = objOf(pile[pile.length - 1]);
      const from = `foundation:${i}`;
      for (const loc of DEST_ORDER) {
        if (loc.startsWith('foundation')) continue;
        const dest = pileAtCompact(st, loc);
        if (!dest) continue;
        const dobjs = dest.map((id) => ({ id, rank: RANK[id], suit: SUIT_NAMES[SUIT[id]], faceUp: !!st.up[id] }));
        if (canMoveToTableau(card, dobjs)) moves.push({ type: 'moveCards', from, to: loc });
      }
    }
  }

  if (st.stock.length > 0) moves.push({ type: 'draw' });
  else if (st.waste.length > 0) moves.push({ type: 'recycle' });

  return moves;
}

// Apply a move to a compact state, mirroring core/moveEngine.js exactly.
function applyCompact(st, m) {
  const n = cloneCompact(st);
  if (m.type === 'draw') {
    const c = n.stock.pop();
    n.waste.push(c);
    n.up[c] = 1;
  } else if (m.type === 'recycle') {
    const w = n.waste;
    const k = w.length;
    for (let i = 0; i < k; i++) {
      const c = w[k - 1 - i];
      n.stock.push(c);
      n.up[c] = 0;
    }
    n.waste = [];
  } else {
    const { from, to, j } = m;
    let moved;
    if (from === 'waste') {
      moved = [n.waste.pop()];
    } else if (from.startsWith('foundation')) {
      const fi = Number(from.split(':')[1]);
      moved = [n.found[fi].pop()];
    } else {
      const ti = Number(from.split(':')[1]);
      moved = n.tab[ti].splice(j); // run from grabbed card to column top
      if (n.tab[ti].length > 0) {
        const top = n.tab[ti][n.tab[ti].length - 1];
        n.up[top] = 1; // auto-flip exposed tableau card
      }
    }
    if (to.startsWith('foundation')) {
      const ti = Number(to.split(':')[1]);
      for (const c of moved) n.found[ti].push(c);
    } else {
      const ti = Number(to.split(':')[1]);
      for (const c of moved) n.tab[ti].push(c);
    }
  }
  return n;
}

// Score moves so the search finds wins faster: prefer filling foundations,
// then exposing face-down tableau cards, then other tableau moves, and defer
// draw/recycle (still explored, just lower priority).
function scoreMove(st, m) {
  if (m.type === 'draw' || m.type === 'recycle') return -1;
  if (m.to.startsWith('foundation')) return 100;
  if (m.from.startsWith('tableau')) {
    const ti = Number(m.from.split(':')[1]);
    const pile = st.tab[ti];
    // The card just below the grabbed run, if face-down, gets exposed.
    if (m.j > 0 && !st.up[pile[m.j - 1]]) return 10;
  }
  return 0;
}

// Returns true iff a full win (all 52 cards in foundations) is actually reached
// within STATE_CAP enqueued states. Returns false if unsolved / cap exceeded.
function solveState(st) {
  const visited = new Set([keyOf(st)]);
  const stack = [st];
  while (stack.length) {
    if (visited.size > STATE_CAP) return false;
    const s = stack.pop();
    if (foundationTotal(s) === 52) return true;
    const moves = genMoves(s, true);
    // Push ascending so the LIFO stack pops the highest-scoring move first
    // (foundation fills before low-priority draw/recycle shuffling).
    moves.sort((a, b) => scoreMove(s, a) - scoreMove(s, b));
    for (const m of moves) {
      const ns = applyCompact(s, m);
      const nk = keyOf(ns);
      if (!visited.has(nk)) {
        visited.add(nk);
        stack.push(ns);
      }
    }
  }
  return false;
}

function solveWithJs(seed) {
  return solveState(toCompact(deal({ seed })));
}

// ---- Main loop -------------------------------------------------------------
function main() {
  const binary = findSolverBinary();
  console.log(binary ? `KlondikeSolver found: ${binary}` : 'KlondikeSolver not found — using embedded JS fallback solver.');

  // Env-driven disjoint range (used for parallel runs): scan [START, END]
  // fresh, writing to OUT_PATH. Otherwise use the resume-based default scan.
  const useEnvRange = process.env.SEED_RANGE_START !== undefined || process.env.SEED_RANGE_END !== undefined;

  const pool = useEnvRange ? loadPoolFrom(OUT_PATH) : loadPool();
  let cursor = useEnvRange ? SEED_RANGE_START : Math.max(loadScanCursor(), SEED_RANGE_START);
  const end = SEED_RANGE_END;

  console.log(`Pool has ${pool.length} seeds. Scanning ${cursor}..${end}. Target ${TARGET_POOL_SIZE}. Out: ${OUT_PATH}`);

  const batchSeeds = [];
  while (cursor <= end && pool.length < TARGET_POOL_SIZE) {
    batchSeeds.push(cursor);
    if (batchSeeds.length >= 200) {
      const solved = binary ? solveWithBinary(batchSeeds) : batchSeeds.filter((s) => solveWithJs(s));
      for (const s of solved) if (!pool.includes(s)) pool.push(s);
      console.log(`${cursor} / ${end} checked, ${pool.length} solvable so far.`);
      saveProgress(pool, cursor);
      batchSeeds.length = 0;
    }
    cursor++;
  }

  // Flush any remainder.
  if (batchSeeds.length) {
    const solved = binary ? solveWithBinary(batchSeeds) : batchSeeds.filter((s) => solveWithJs(s));
    for (const s of solved) if (!pool.includes(s)) pool.push(s);
    console.log(`${cursor} / ${end} checked, ${pool.length} solvable so far.`);
  }
  saveProgress(pool, cursor);
  console.log(`Done. Pool size: ${pool.length}. Written to ${OUT_PATH}`);
}

// Only auto-run when executed directly (so the solver functions can be imported
// for testing without kicking off the full scan).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { solveWithJs, solveWithBinary, genMoves, deckStringForSeed, solveState, toCompact, applyCompact, foundationTotal, keyOf, SEED_RANGE_END };
