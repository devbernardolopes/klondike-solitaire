// scripts/generateEventSeeds.mjs
//
// Generate page/grid-aware Special Event seeds as pre-verified solvable seeds,
// emitting ready-to-run SQL INSERT statements for the Phase-1 schema
// (supabase/klondike_supabase_migration_022.sql).
//
// Usage:
//   node scripts/generateEventSeeds.mjs [--catalog <path>] [--out <path>] [--resume] [--smoke]
//
// Catalog input (JSON array) describes each event with its pages:
//   [{
//     "id": "christmas-2026",
//     "title": "Christmas 2026",
//     "description": "A festive three-page collection.",
//     "startsAt": "2026-12-18T00:00:00Z",
//     "gameKind": "draw-1",
//     "sortOrder": 10,
//     "pages": [
//       { "gridSize": 2, "imagePath": "christmas-2026/page1.png", "coinReward": 50 },
//       { "gridSize": 3, "imagePath": "christmas-2026/page2.png", "coinReward": 100 }
//     ]
//   }]
//
// Output SQL follows the authoring template in migration_022.sql exactly,
// extended by migration_029.sql with the event-sequential `deal_number`:
//   - special_events INSERT (one per event) — idempotent via on-conflict
//   - special_event_pages INSERT (one VALUES list per event)
//   - special_event_deals INSERT per page, using unnest(array[position...],
//     array[seed...], array[deal_number...]) resolved via subquery on
//     special_event_pages
//
// Positions are row-major: position 1 = top-left, gridSize*gridSize = bottom-right.
// This is the authoring convention EventDealGrid.jsx relies on for postcard slicing.
// Deal numbers are event-sequential: page 1 of a 2x2+3x3 event owns 1-4, page 2
// owns 5-13. EventDealGrid.jsx displays deal_number; position still drives layout.
//
// Env: SOLVER_PATH (or KlondikeSolver on PATH) for the fast binary path;
//      otherwise the embedded pure-JS solver is used.

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { findSolverBinary } from './generateSolvablePool.mjs';
import { cyrb53, fillSeeds, solveBatch, loadJson } from './lib/seedHelpers.mjs';
import { buildUsedSet } from './generateDaily.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CATALOG = join(__dirname, 'eventCatalog.src.json');
const DEFAULT_OUT = join(__dirname, 'eventSeeds.sql');

// ---- SQL helpers ----

function sqlEscape(str) {
  return String(str).replace(/'/g, "''");
}

// ---- Resume support: parse existing SQL to find already-authored pages + seeds ----

const DEAL_HEADER = /select id, unnest\(array\[([^\]]+)\]\), unnest\(array\[([^\]]+)\]::bigint\[\]\)/i;

function parseExistingDeals(sqlText) {
  const seenPages = new Map(); // event_id -> Set<page_number>
  const usedSeeds = new Set();
  const preservedBlocks = new Map(); // `${eventId}:${pageNumber}` -> verbatim SQL block

  // Find each special_event_deals block.
  const dealRegex = /insert into special_event_deals\b([\s\S]*?)where event_id = '([^']+)' and page_number = (\d+);/gi;
  let m;
  while ((m = dealRegex.exec(sqlText)) !== null) {
    const body = m[1];
    const eventId = m[2];
    const pageNum = parseInt(m[3], 10);
    if (!seenPages.has(eventId)) seenPages.set(eventId, new Set());
    seenPages.get(eventId).add(pageNum);
    preservedBlocks.set(`${eventId}:${pageNum}`, m[0]);

    const arrays = DEAL_HEADER.exec(body);
    if (arrays) {
      const seedStr = arrays[2];
      for (const tok of seedStr.split(',')) {
        const n = Number(tok.trim());
        if (Number.isInteger(n)) usedSeeds.add(n >>> 0);
      }
    }
  }
  return { seenPages, usedSeeds, preservedBlocks };
}

// ---- SQL generation ----

function generateDealSection(eventId, pageNumber, gridSize, seeds, dealOffset = 0) {
  const count = seeds.length;
  const positions = Array.from({ length: count }, (_, i) => i + 1);
  const dealNumbers = Array.from({ length: count }, (_, i) => dealOffset + i + 1);
  const posArr = `array[${positions.join(',')}]`;
  const seedArr = `array[${seeds.join(',')}]::bigint[]`;
  const numArr = `array[${dealNumbers.join(',')}]`;

  return [
    `-- Page ${pageNumber} (${gridSize}×${gridSize} = ${count} deals), positions 1..${count} row-major, deals ${dealNumbers[0]}..${dealNumbers[count - 1]} event-sequential:`,
    `insert into special_event_deals (page_id, "position", seed, deal_number)`,
    `select id, unnest(${posArr}), unnest(${seedArr}), unnest(${numArr})`,
    `  from special_event_pages`,
    `  where event_id = '${sqlEscape(eventId)}' and page_number = ${pageNumber};`,
    '',
  ].join('\n');
}

function generateEventSql(event, used, solveFn, seenPages, preservedBlocks) {
  const { id, title, description, startsAt, gameKind, sortOrder, pages } = event;
  const lines = [];

  // --- special_events row ---
  const descVal = description ? `'${sqlEscape(description)}'` : 'null';
  lines.push(`-- Event: ${id} (${title})`);
  lines.push(`insert into special_events (id, title, description, starts_at, game_kind, sort_order)`);
  lines.push(`values ('${sqlEscape(id)}', '${sqlEscape(title)}', ${descVal}, '${sqlEscape(startsAt)}', '${sqlEscape(gameKind)}', ${sortOrder});`);
  lines.push('');

  // --- special_event_pages rows ---
  lines.push(`insert into special_event_pages (event_id, page_number, grid_size, image_path, coin_reward)`);
  lines.push('values');
  const pageVals = pages.map((p, i) => {
    const pageNumber = i + 1;
    const img = p.imagePath || `event-${id}/page${pageNumber}.png`;
    const coins = p.coinReward || 0;
    return `  ('${sqlEscape(id)}', ${pageNumber}, ${p.gridSize}, '${sqlEscape(img)}', ${coins})`;
  });
  lines.push(pageVals.join(',\n') + ';');
  lines.push('');

  // --- special_event_deals rows (per page) ---
  // dealOffset tracks the event-sequential Deal N across pages (page 1 with 4
  // deals occupies 1-4, so page 2 starts at 5). It advances even for
  // --resume-skipped pages: their preserved blocks already own those numbers
  // in the DB (backfilled by migration 029), so new pages must not reuse them.
  let dealOffset = 0;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageNumber = i + 1;
    const gridSize = page.gridSize;
    const dealCount = gridSize * gridSize;

    if (seenPages && seenPages.has(id) && seenPages.get(id).has(pageNumber)) {
      const preserved = preservedBlocks && preservedBlocks.get(`${id}:${pageNumber}`);
      if (preserved) {
        lines.push(preserved.trim());
        lines.push('');
      } else {
        lines.push(`-- Page ${pageNumber} (${gridSize}×${gridSize} = ${dealCount} deals) — already authored, skipping.`);
        lines.push('');
      }
      dealOffset += dealCount;
      continue;
    }

    const base = cyrb53(`${id}:page${pageNumber}`);
    const seeds = fillSeeds(base, dealCount, used, solveFn);
    lines.push(generateDealSection(id, pageNumber, gridSize, seeds, dealOffset));
    dealOffset += dealCount;
  }

  return lines.join('\n');
}

// ---- Core generation routine ----

function generateAll({ catalog, used, solveFn, seenPages, preservedBlocks }) {
  const sections = [];
  const stats = [];

  for (const event of catalog) {
    sections.push(generateEventSql(event, used, solveFn, seenPages, preservedBlocks));
    const totalDeals = event.pages.reduce((sum, p) => sum + p.gridSize * p.gridSize, 0);
    stats.push({ eventId: event.id, events: 1, totalDeals });
  }

  return { sql: sections.join('\n'), stats };
}

// ---- Entry points ----

function main() {
  const args = process.argv.slice(2);
  const smoke = args.includes('--smoke');
  const resume = args.includes('--resume');

  const flag = (name) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : null;
  };
  const catalogPath = flag('--catalog') || DEFAULT_CATALOG;
  const outPath = flag('--out') || DEFAULT_OUT;

  const binary = findSolverBinary();
  const solveFn = (seeds) => solveBatch(seeds, binary);

  if (smoke) {
    const catalog = [
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
    const used = new Set();
    const { sql, stats } = generateAll({ catalog, used, solveFn: stubSolve, seenPages: null });

    // --- Validate deal counts (stats[0] is the smoke event total across all its pages: 2×2 + 3×3 = 13) ---
    if (stats[0].totalDeals !== 13) throw new Error(`SMOKE FAIL: expected 13 deals across pages, got ${stats[0].totalDeals}`);

    // --- Validate SQL structure ---
    if (!sql.includes('insert into special_events')) throw new Error('SMOKE FAIL: missing special_events INSERT');
    if (!sql.includes('insert into special_event_pages')) throw new Error('SMOKE FAIL: missing special_event_pages INSERT');
    if (!sql.includes('insert into special_event_deals')) throw new Error('SMOKE FAIL: missing special_event_deals INSERT');

    // --- Validate row-major positions ---
    const posMatch = sql.match(/unnest\(array\[([^\]]+)\]\)/);
    if (!posMatch) throw new Error('SMOKE FAIL: no position array found');
    const pos2x2 = posMatch[1].split(',').map(Number);
    if (JSON.stringify(pos2x2) !== JSON.stringify([1, 2, 3, 4])) {
      throw new Error(`SMOKE FAIL: 2×2 positions not row-major: ${JSON.stringify(pos2x2)}`);
    }

    // --- Validate event-sequential deal numbers (page 1: 1-4, page 2: 5-13) ---
    // Each deal section emits positions + deal_numbers matching
    // /unnest\(array\[...\]\)/ (the seed array carries a ::bigint[] suffix so
    // it never matches). Order per page: positions, then deal numbers.
    const numArrays = [...sql.matchAll(/unnest\(array\[([^\]]+)\]\)/g)].map((m) => m[1].split(',').map(Number));
    if (numArrays.length !== 4) throw new Error(`SMOKE FAIL: expected 4 unnest arrays (positions + deal_numbers per page), got ${numArrays.length}`);
    if (JSON.stringify(numArrays[1]) !== JSON.stringify([1, 2, 3, 4])) {
      throw new Error(`SMOKE FAIL: page 1 deal numbers not 1-4: ${JSON.stringify(numArrays[1])}`);
    }
    if (JSON.stringify(numArrays[2]) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
      throw new Error(`SMOKE FAIL: page 2 positions not row-major 1-9: ${JSON.stringify(numArrays[2])}`);
    }
    if (JSON.stringify(numArrays[3]) !== JSON.stringify([5, 6, 7, 8, 9, 10, 11, 12, 13])) {
      throw new Error(`SMOKE FAIL: page 2 deal numbers not 5-13: ${JSON.stringify(numArrays[3])}`);
    }
    if (!sql.includes('deal_number')) throw new Error('SMOKE FAIL: missing deal_number column in INSERT');

    // --- Validate all seeds are "solvable" (stub: divisible by 3) ---
    const seedRegex = /unnest\(array\[([^\]]+)\]::bigint\[\]\)/g;
    let s;
    while ((s = seedRegex.exec(sql)) !== null) {
      const seeds = s[1].split(',').map(Number);
      for (const seed of seeds) {
        if (seed % 3 !== 0) throw new Error(`SMOKE FAIL: non-solvable seed ${seed} admitted`);
      }
    }

    // --- Validate uniqueness ---
    const allSeeds = [];
    const sr = /unnest\(array\[([^\]]+)\]::bigint\[\]\)/g;
    while ((s = sr.exec(sql)) !== null) {
      for (const tok of s[1].split(',')) allSeeds.push(Number(tok));
    }
    const uniq = new Set(allSeeds);
    if (uniq.size !== allSeeds.length) {
      throw new Error(`SMOKE FAIL: ${allSeeds.length - uniq.size} duplicate seeds`);
    }

    console.log(
      `SMOKE OK: ${stats.length} events, ${stats.reduce((a, s) => a + s.totalDeals, 0)} total deals ` +
      `(2×2=4, 3×3=9), all unique & solvable, row-major positions.`,
    );
    return;
  }

  // --- Full run ---
  const catalog = loadJson(catalogPath, []);
  if (!Array.isArray(catalog) || catalog.length === 0) {
    console.error(`No events found in catalog: ${catalogPath}`);
    console.error('Create a catalog JSON file (see --catalog flag or eventCatalog.src.json for the schema).');
    process.exit(1);
  }

  // Build exclusion set from pool + daily + existing SQL seeds (if resuming).
  const used = buildUsedSet();
  let seenPages = null;
  let preservedBlocks = null;
  if (resume && existsSync(outPath)) {
    const existingSql = readFileSync(outPath, 'utf8');
    const parsed = parseExistingDeals(existingSql);
    for (const seed of parsed.usedSeeds) used.add(seed);
    seenPages = parsed.seenPages;
    preservedBlocks = parsed.preservedBlocks;
    console.error(`Resuming from ${outPath}: ${[...parsed.usedSeeds].length} existing seeds, skipping already-authored pages.`);
  }

  console.error(binary ? `KlondikeSolver found: ${binary}` : 'KlondikeSolver not found — using embedded JS fallback (slow).');

  const { sql, stats } = generateAll({ catalog, used, solveFn, seenPages, preservedBlocks });

  const header = [
    `-- ============================================================`,
    `-- Special Event deal seeds — auto-generated by scripts/generateEventSeeds.mjs`,
    `-- Generated: ${new Date().toISOString()}`,
    `-- Solver: ${binary ? `KlondikeSolver binary (${binary})` : 'embedded JS fallback'}`,
    `-- Positions are row-major: position 1 = top-left, gridSize² = bottom-right.`,
    `-- Deal numbers are event-sequential across pages: page 1 (2x2) owns 1-4, page 2 starts at 5.`,
    `-- Paste into: Supabase Dashboard > SQL Editor > Run`,
    `-- ============================================================`,
    '',
  ].join('\n');

  writeFileSync(outPath, header + '\n' + sql + '\n');

  console.log(`Done. SQL written to ${outPath}.`);
  for (const s of stats) {
    console.log(`  ${s.eventId}: ${s.totalDeals} deals across ${s.events} event(s)`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

export { generateEventSql, generateAll, parseExistingDeals, sqlEscape };
