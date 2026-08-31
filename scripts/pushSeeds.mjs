// scripts/pushSeeds.mjs
// Upsert bundled JSON pools into Supabase (service_role only).
// Idempotent — safe to re-run. Used by local generation workflow:
//
//   node scripts/pushSeeds.mjs                 # push all 3 pools from src/data/*.json/.fallback
//   node scripts/pushSeeds.mjs --winning-only  # only winning_seeds
//   node scripts/pushSeeds.mjs --dry-run       # no writes, just report counts
//
// Env: SUPABASE_URL / VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function resolvePaths() {
  const candidates = [
    { kind: 'winning', path: join(DATA_DIR, 'solvableSeeds.json'), fallback: join(DATA_DIR, 'solvableSeeds.fallback.json') },
    { kind: 'daily', path: join(DATA_DIR, 'dailyChallenge.json'), fallback: join(DATA_DIR, 'dailyChallenge.fallback.json') },
    { kind: 'events', path: join(DATA_DIR, 'specialEvents.json'), fallback: null },
    { kind: 'catalog', path: join(DATA_DIR, 'eventCatalog.json'), fallback: join(DATA_DIR, 'eventCatalog.fallback.json') },
  ];
  return candidates.map(({ kind, path, fallback }) => {
    const eff = existsSync(path) ? path : fallback && existsSync(fallback) ? fallback : null;
    return { kind, path: eff };
  });
}

async function upsertInBatches(supabase, table, rows, batchSize = 500) {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: table === 'winning_seeds' ? 'seed' : table === 'daily_seeds' ? 'date' : 'id' });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    upserted += batch.length;
  }
  return upserted;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const winningOnly = args.includes('--winning-only');
  const dailyOnly = args.includes('--daily-only');
  const eventsOnly = args.includes('--events-only');

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dryRun && (!url || !serviceKey)) {
    console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY in env.');
    process.exit(1);
  }

  const supabase = dryRun ? null : createClient(url, serviceKey);
  const paths = resolvePaths();

  // ---- Winning seeds ----
  if (!dailyOnly && !eventsOnly) {
    const wp = paths.find((p) => p.kind === 'winning');
    let seeds = [];
    if (wp.path) {
      const raw = loadJson(wp.path, []);
      seeds = Array.isArray(raw) ? raw : [];
    }
    console.log(`Winning seeds: ${seeds.length} from ${wp.path ?? '(none)'}`);
    if (!dryRun && seeds.length) {
      const rows = seeds.map((seed, i) => ({ seed, enabled: true, sort_order: i }));
      const n = await upsertInBatches(supabase, 'winning_seeds', rows);
      console.log(`  upserted ${n} into winning_seeds`);
    }
  }

  // ---- Daily seeds ----
  if (!winningOnly && !eventsOnly) {
    const dp = paths.find((p) => p.kind === 'daily');
    const daily = dp.path ? loadJson(dp.path, null) : null;
    const map = daily && daily.seeds ? daily.seeds : {};
    const entries = Object.entries(map);
    console.log(`Daily seeds: ${entries.length} from ${dp.path ?? '(none)'}`);
    if (!dryRun && entries.length) {
      const rows = entries.map(([date, seed]) => ({ date, seed, enabled: true }));
      let upserted = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await supabase.from('daily_seeds').upsert(batch, { onConflict: 'date' });
        if (error) throw new Error(`daily_seeds upsert failed: ${error.message}`);
        upserted += batch.length;
      }
      console.log(`  upserted ${upserted} into daily_seeds`);
    }
  }

  // ---- Special events (catalog + seeds) ----
  if (!winningOnly && !dailyOnly) {
    const cp = paths.find((p) => p.kind === 'catalog');
    const ep = paths.find((p) => p.kind === 'events');
    const catalog = cp.path ? loadJson(cp.path, { events: [] }) : { events: [] };
    const eventsDoc = ep.path ? loadJson(ep.path, { events: [] }) : { events: [] };
    const seedsById = new Map((eventsDoc.events || []).map((e) => [e.id, e.seeds || []]));
    const events = catalog.events || [];
    console.log(`Special events: ${events.length} from ${cp.path ?? '(none)'} + seeds from ${ep.path ?? '(none)'}`);
    if (!dryRun && events.length) {
      const eventRows = events.map((e, i) => ({
        id: e.id,
        title: e.title || e.id,
        description: e.description || null,
        enabled: true,
        sort_order: i,
        image_paths: Array.isArray(e.images) ? e.images : [],
      }));
      const n = await upsertInBatches(supabase, 'special_events', eventRows, 500);
      console.log(`  upserted ${n} into special_events`);
      for (const e of events) {
        const seeds = seedsById.get(e.id) || [];
        if (seeds.length === 0) continue;
        const rows = seeds.map((seed, idx) => ({ event_id: e.id, seed, sort_order: idx }));
        const { error } = await supabase.from('special_event_seeds').upsert(rows, { onConflict: 'event_id,seed' });
        if (error) throw new Error(`special_event_seeds upsert for ${e.id} failed: ${error.message}`);
        console.log(`  upserted ${rows.length} seeds for event ${e.id}`);
      }
    }
  }

  if (dryRun) console.log('(dry-run — no writes)');
  else console.log('Done.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
