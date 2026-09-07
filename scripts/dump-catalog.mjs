// scripts/dump-catalog.mjs
// Reads the three Supabase catalog tables and writes one SQL dump file per
// table to supabase/. These dumps are the canonical source for
// scripts/i18n-sync.mjs — the locale `db.*` sections are derived from them.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/dump-catalog.mjs
//   npm run catalog:dump
//
// The env vars can live in `.env.local` (git-ignored) — the script does not
// commit secrets to disk. We deliberately do NOT pull from `import.meta.env`
// (Vite-only) here; this is a Node script and must work standalone.

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ------------------------------------------------------------
// Env loading — read .env.local (git-ignored). Do NOT add a
// dotenv dep just for this; one tiny line keeps it standalone.
// ------------------------------------------------------------
function loadEnvLocal() {
  const path = resolve(REPO_ROOT, '.env.local');
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}
loadEnvLocal();

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE_KEY) {
  console.error(
    'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Set them in .env.local (git-ignored) or pass as env vars.\n' +
      'See .env.example for the variable names.',
  );
  process.exit(1);
}

// ------------------------------------------------------------
// Dump definitions. Each entry: (table, dump file, columns, rowShape).
// rowShape decides which i18n-sync.mjs namespace + field keys to use.
// ------------------------------------------------------------
const DUMPS = [
  {
    table: 'achievements_definitions',
    out: 'supabase/achievements_definitions.sql',
    columns: ['id', 'name', 'description'],
    namespace: 'achievements',
    fields: { name: 'name', description: 'description' },
  },
  {
    table: 'store_items',
    out: 'supabase/store_items.dump.sql',
    columns: ['id', 'name', 'description'],
    namespace: 'storeItems',
    fields: { name: 'name', description: 'description' },
  },
  {
    table: 'special_events',
    out: 'supabase/special_events.dump.sql',
    columns: ['id', 'title', 'description'],
    namespace: 'specialEvents',
    fields: { name: 'title', description: 'description' },
  },
];

// ------------------------------------------------------------
// SQL string escaping — matches Postgres standard string
// literal rules: single-quote doubling.
// ------------------------------------------------------------
function sqlEscape(v) {
  if (v == null) return 'null';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function renderDump({ table, columns, rows, generatedAt }) {
  const header = [
    `-- ============================================================`,
    `-- Catalog dump — generated ${generatedAt}`,
    `-- Source of truth for scripts/i18n-sync.mjs. Do not edit by hand.`,
    `-- Re-run \`npm run catalog:dump\` after any dashboard edits.`,
    `-- Idempotent: safe to paste into Supabase SQL editor and re-run.`,
    `-- ============================================================`,
    ``,
  ].join('\n');

  if (rows.length === 0) {
    return header + `-- (no rows in ${table})\n`;
  }

  const colList = columns.join(', ');
  const colListQualified = columns.map((c) => (c === 'title' ? 'title' : c)).join(', ');

  // We emit one INSERT ... ON CONFLICT DO UPDATE so pasting the dump
  // into the Supabase SQL editor is idempotent and converges state.
  const values = rows
    .map((r) => `  (${columns.map((c) => sqlEscape(r[c])).join(', ')})`)
    .join(',\n');

  const updateSets = columns
    .filter((c) => c !== 'id')
    .map((c) => `  ${c} = excluded.${c}`)
    .join(',\n');

  return (
    header +
    `INSERT INTO public.${table} (${colListQualified}) VALUES\n` +
    values +
    `\nON CONFLICT (id) DO UPDATE SET\n${updateSets};\n`
  );
}

// ------------------------------------------------------------
// Main — connect, fetch each table, write dump.
// ------------------------------------------------------------
async function main() {
  const supabase = createClient(URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const generatedAt = new Date().toISOString();

  for (const def of DUMPS) {
    process.stdout.write(`dumping ${def.table}... `);
    const { data, error } = await supabase
      .from(def.table)
      .select(def.columns.join(','))
      .order('id', { ascending: true });

    if (error) {
      console.error(`\nFAILED: ${error.message}`);
      process.exit(1);
    }
    if (!data) {
      console.error(`\nFAILED: no data returned for ${def.table}`);
      process.exit(1);
    }

    const sql = renderDump({ table: def.table, columns: def.columns, rows: data, generatedAt });
    const outPath = resolve(REPO_ROOT, def.out);
    writeFileSync(outPath, sql, 'utf8');
    console.log(`${data.length} rows -> ${def.out}`);
  }

  console.log('\nDone. Next: run `npm run i18n:fix` to sync the locale files.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
