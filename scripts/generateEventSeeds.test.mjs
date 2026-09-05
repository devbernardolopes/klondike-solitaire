// scripts/generateEventSeeds.test.mjs
// Unit tests for the page/grid-aware event seed SQL generator.

import { generateAll } from './generateEventSeeds.mjs';

// ---- Smoke test: validate structure & row-major positions ----

const smokeCatalog = [
  {
    id: 'smoke-event',
    title: 'Smoke Event',
    description: 'A test event for the generator.',
    startsAt: '2026-01-01T00:00:00Z',
    gameKind: 'draw-1',
    sortOrder: 1,
    pages: [
      { gridSize: 2, imagePath: 'smoke/page1.png', coinReward: 50 },
      { gridSize: 3, imagePath: 'smoke/page2.png', coinReward: 100 },
    ],
  },
];

const stubSolve = (seeds) => seeds.filter((s) => s % 3 === 0);

const { sql: smokeSql, stats } = generateAll({
  catalog: smokeCatalog,
  used: new Set(),
  solveFn: stubSolve,
  seenPages: null,
});

// --- Validate deal counts per page ---
// smoke catalog: 2 pages → 2×2=4 deals + 3×3=9 deals = 13 total
// Positions are row-major: 2×2 → positions 1,2,3,4; 3×3 → positions 1..9
const pos2x2Match = smokeSql.match(/unnest\(array\[([^\]]+)\]\)/);
if (!pos2x2Match) throw new Error('SMOKE FAIL: no position array found');
const pos2x2 = pos2x2Match[1].split(',').map(Number);
if (JSON.stringify(pos2x2) !== JSON.stringify([1, 2, 3, 4])) {
  throw new Error(`SMOKE FAIL: 2×2 positions not row-major: ${JSON.stringify(pos2x2)}`);
}

// Count deals per page from the position array lengths
// Page 1 (2×2): first unnest positions array length = 4
const page1PosArr = pos2x2Match[1];
const page1DealCount = page1PosArr.split(',').length;
if (page1DealCount !== 4) throw new Error(`SMOKE FAIL: page 1 (2×2) expected 4 deals, got ${page1DealCount}`);

// For page 2, we need to find the second page's position array.
// Each deal section now emits positions + deal_numbers matching
// /unnest\(array\[...\]\)/ (the seed array carries a ::bigint[] suffix so it
// never matches): [pos_p1, num_p1, pos_p2, num_p2].
const allPosMatches = smokeSql.matchAll(/unnest\(array\[([^\]]+)\]\)/g);
const posArrays = [];
for (const m of allPosMatches) {
  posArrays.push(m[1]);
}
// Page 1 positions = posArrays[0] (2×2 = 4 deals)
// Page 1 deal numbers = posArrays[1] (event-sequential 1-4)
// Page 2 positions = posArrays[2] (3×3 = 9 deals)
// Page 2 deal numbers = posArrays[3] (event-sequential 5-13)
if (posArrays.length !== 4) throw new Error(`SMOKE FAIL: expected 4 arrays (positions + deal_numbers per page), got ${posArrays.length}`);
const page2PosArr = posArrays[2].split(',').map(Number);
const page2DealCount = page2PosArr.length;
if (page2DealCount !== 9) throw new Error(`SMOKE FAIL: page 2 (3×3) expected 9 deals, got ${page2DealCount}`);

// Validate row-major for 3×3 as well
if (JSON.stringify(page2PosArr) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
  throw new Error(`SMOKE FAIL: 3×3 positions not row-major: ${JSON.stringify(page2PosArr)}`);
}

// Validate event-sequential deal numbers: page 1 owns 1-4, page 2 owns 5-13.
const page1NumArr = posArrays[1].split(',').map(Number);
if (JSON.stringify(page1NumArr) !== JSON.stringify([1, 2, 3, 4])) {
  throw new Error(`SMOKE FAIL: page 1 deal numbers not 1-4: ${JSON.stringify(page1NumArr)}`);
}
const page2NumArr = posArrays[3].split(',').map(Number);
if (JSON.stringify(page2NumArr) !== JSON.stringify([5, 6, 7, 8, 9, 10, 11, 12, 13])) {
  throw new Error(`SMOKE FAIL: page 2 deal numbers not 5-13: ${JSON.stringify(page2NumArr)}`);
}
if (!smokeSql.includes('deal_number')) throw new Error('SMOKE FAIL: missing deal_number column in INSERT');

// Validate all seeds are "solvable" (stub: divisible by 3)
const seedRegex = /unnest\(array\[([^\]]+)\]::bigint\[\]\)/g;
let s;
while ((s = seedRegex.exec(smokeSql)) !== null) {
  const seeds = s[1].split(',').map(Number);
  for (const seed of seeds) {
    if (seed % 3 !== 0) throw new Error(`SMOKE FAIL: non-solvable seed ${seed} admitted`);
  }
}

// --- Validate SQL structure ---
if (!smokeSql.includes('insert into special_events')) throw new Error('SMOKE FAIL: missing special_events INSERT');
if (!smokeSql.includes('insert into special_event_pages')) throw new Error('SMOKE FAIL: missing special_event_pages INSERT');
if (!smokeSql.includes('insert into special_event_deals')) throw new Error('SMOKE FAIL: missing special_event_deals INSERT');

// --- Validate uniqueness ---
const allSeeds = [];
const sr = /unnest\(array\[([^\]]+)\]::bigint\[\]\)/g;
while ((s = sr.exec(smokeSql)) !== null) {
  for (const tok of s[1].split(',')) allSeeds.push(Number(tok));
}
const uniq = new Set(allSeeds);
if (uniq.size !== allSeeds.length) {
  throw new Error(`SMOKE FAIL: ${allSeeds.length - uniq.size} duplicate seeds`);
}

console.log(`PASS: 2 events (2×2=4 deals + 3×3=9 deals), all unique & solvable, row-major positions.`);

// ---- Multi-event test: validate all events are processed ---

const multiCatalog = [
  {
    id: 'event-a',
    title: 'Event A',
    description: 'Test event A',
    startsAt: '2026-01-15T00:00:00Z',
    gameKind: 'draw-1',
    sortOrder: 0,
    pages: [
      { gridSize: 2, imagePath: 'ea/page1.png', coinReward: 10 },
    ],
  },
  {
    id: 'event-b',
    title: 'Event B',
    description: 'Test event B',
    startsAt: '2026-02-01T00:00:00Z',
    gameKind: 'draw-1',
    sortOrder: 1,
    pages: [
      { gridSize: 3, imagePath: 'eb/page1.png', coinReward: 20 },
    ],
  },
];

const { sql: multiSql, stats: multiStats } = generateAll({
  catalog: multiCatalog,
  used: new Set(),
  solveFn: stubSolve,
  seenPages: null,
});

if (multiStats.length !== 2) throw new Error(`MULTI FAIL: expected 2 events, got ${multiStats.length}`);

// Validate each event has correct deal counts
const multiPosMatches = [];
const sr2 = /unnest\(array\[([^\]]+)\]\)/g;
let mm;
while ((mm = sr2.exec(multiSql)) !== null) {
  multiPosMatches.push(mm[1]);
}

for (let i = 0; i < multiCatalog.length; i++) {
  // Each single-page event emits positions + deal_numbers; positions lead.
  const eventPosArr = multiPosMatches[i * 2].split(',').map(Number);
  const expectedDeals = multiCatalog[i].pages.reduce((sum, p) => sum + p.gridSize * p.gridSize, 0);
  if (eventPosArr.length !== expectedDeals) {
    throw new Error(`MULTI FAIL: event ${multiCatalog[i].id} expected ${expectedDeals} deals, got ${eventPosArr.length}`);
  }
}

// Validate row-major positions for each event
for (let i = 0; i < multiCatalog.length; i++) {
  // Simpler: just check the positions are 1..N row-major
  const expected = Array.from({ length: multiCatalog[i].pages.reduce((s, p) => s + p.gridSize * p.gridSize, 0) }, (_, k) => k + 1);
  const actual = multiPosMatches[i * 2].split(',').map(Number);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`MULTI FAIL: event ${multiCatalog[i].id} positions not row-major: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Validate seeds divisible by 3 for multi-event
const multiSeedRegex = /unnest\(array\[([^\]]+)\]::bigint\[\]\)/g;
let ss;
while ((ss = multiSeedRegex.exec(multiSql)) !== null) {
  const seeds = ss[1].split(',').map(Number);
  for (const seed of seeds) {
    if (seed % 3 !== 0) throw new Error(`MULTI FAIL: non-solvable seed ${seed} admitted`);
  }
}

console.log('PASS: Multi-event test passed.');
console.log('All generateEventSeeds.mjs smoke tests passed.');