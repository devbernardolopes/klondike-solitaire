// scripts/i18n-sync.mjs
// Reconciles src/i18n/locales/*.db.json catalog sections against the Supabase
// catalog dumps under supabase/*.dump.sql + supabase/achievements_definitions.sql.
//
// The dumps are the canonical source of truth; the `*.db.json` locale files
// are a derived artifact. The dumps contain a superset of catalog data — we
// project just (id, name/title, description) into the locales.
//
// Two modes:
//   --check (default): exit non-zero on any drift. Used by CI / pre-commit.
//   --fix:             rewrite the locale files to match the dumps.
//
// Idempotent in both modes.

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const LOCALES_DIR = resolve(REPO_ROOT, 'src/i18n/locales');

const args = new Set(process.argv.slice(2));
const FIX = args.has('--fix');
const CHECK = !FIX;
const LANG_KEYS = ['en', 'fr', 'de', 'it', 'es', 'pt-BR'];
const EN_KEY = 'en';

// ------------------------------------------------------------
// Dump sources. Each entry maps a locale `<namespace>` tree inside
// `*.db.json` (i18next `db` namespace) to a SQL dump file, plus which
// DB column provides the locale "name" field (title for
// special_events, name otherwise).
// ------------------------------------------------------------
const SOURCES = [
  {
    namespace: 'achievements',
    file: 'supabase/achievements_definitions.sql',
    nameField: 'name',
  },
  {
    namespace: 'storeItems',
    file: 'supabase/store_items.dump.sql',
    nameField: 'name',
  },
  {
    namespace: 'specialEvents',
    file: 'supabase/special_events.dump.sql',
    nameField: 'title',
  },
];

// ------------------------------------------------------------
// SQL parsing. We accept two shapes that the existing repo
// already produces:
//
//   1) Multi-row VALUES list (modern dump-catalog output):
//        INSERT INTO public.foo (id, name, description) VALUES
//          ('a', 'Name A', 'Desc A'),
//          ('b', 'Name B', 'Desc B')
//        ON CONFLICT (id) DO UPDATE SET ...;
//
//   2) Inline VALUES tuple stream (legacy pg_dump / the
//      current achievements_definitions.sql on a single line):
//        INSERT INTO "public"."foo" ("id","name","description")
//        VALUES ('a','Name A','Desc A'),('b','Name B','Desc B'),...
//
// We do NOT try to be a real SQL parser — we extract the
// (id, name/description) tuples directly with a regex on the
// VALUES region. False positives are possible (e.g. an
// apostrophe inside a name) but in practice the dumps carry
// no such content.
// ------------------------------------------------------------
function parseDump(sqlText, nameField) {
  const rows = new Map(); // id -> { name, description }

  // Find the column list. Accept either "INSERT INTO public.foo (a, b, c)"
  // or "INSERT INTO \"public\".\"foo\" (\"a\",\"b\",\"c\")".
  const colMatch = sqlText.match(
    /insert\s+into\s+(?:"?public"?\.)?"?\w+"?\s*\(([^)]+)\)\s*values/i,
  );
  if (!colMatch) return rows;
  const cols = colMatch[1]
    .split(',')
    .map((c) => c.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'));
  const idIdx = cols.indexOf('id');
  const nameIdx = cols.indexOf(nameField);
  const descIdx = cols.indexOf('description');
  if (idIdx < 0 || nameIdx < 0 || descIdx < 0) {
    throw new Error(
      `Dump missing required columns. Found: [${cols.join(', ')}]; need id, ${nameField}, description.`,
    );
  }

  // Grab the VALUES region — everything between the first VALUES and either
  // ON CONFLICT or end of string.
  const valuesStart = sqlText.toLowerCase().indexOf('values');
  if (valuesStart < 0) return rows;
  const afterValues = sqlText.slice(valuesStart + 6);
  const endMatch = afterValues.match(/\n?\s*on\s+conflict/i);
  const region = endMatch
    ? afterValues.slice(0, endMatch.index)
    : afterValues.replace(/;\s*$/, '');

  // Extract individual tuples. We split on `),(` boundaries outside quotes.
  const tuples = splitTuples(region);

  for (const tuple of tuples) {
    const fields = parseTuple(tuple);
    if (fields.length <= Math.max(idIdx, nameIdx, descIdx)) continue;
    const id = unquote(fields[idIdx]);
    if (!id) continue;
    rows.set(id, {
      name: unquote(fields[nameIdx]),
      description: unquote(fields[descIdx]),
    });
  }
  return rows;
}

function splitTuples(region) {
  const out = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let buf = '';
  for (let i = 0; i < region.length; i++) {
    const ch = region[i];
    const prev = i > 0 ? region[i - 1] : '';
    if (ch === "'" && prev !== '\\' && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && prev !== '\\' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          buf += ch;
          const trimmed = buf.trim().replace(/^,/, '').trim();
          if (trimmed) out.push(trimmed);
          buf = '';
          continue;
        }
      }
    }
    if (depth > 0) buf += ch;
  }
  return out;
}

function parseTuple(tuple) {
  // Strip outer parens
  let t = tuple.trim();
  if (t.startsWith('(')) t = t.slice(1);
  if (t.endsWith(')')) t = t.slice(0, -1);

  const fields = [];
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    const prev = i > 0 ? t[i - 1] : '';
    if (ch === "'" && prev !== '\\' && !inDouble) {
      inSingle = !inSingle;
      buf += ch;
      continue;
    }
    if (ch === '"' && prev !== '\\' && !inSingle) {
      inDouble = !inDouble;
      buf += ch;
      continue;
    }
    if (ch === ',' && !inSingle && !inDouble) {
      fields.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  fields.push(buf.trim());
  return fields;
}

function unquote(s) {
  if (s == null) return '';
  const t = s.trim();
  if (t === 'null' || t === 'NULL') return '';
  if (
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith('"') && t.endsWith('"'))
  ) {
    let inner = t.slice(1, -1);
    inner = inner.replace(/''/g, "'");
    return inner;
  }
  return t;
}

// ------------------------------------------------------------
// Locale IO — load all 6 base + db pairs, save back, stable key ordering.
// Base UI strings live in `<lang>.json`; DB-mirrored catalog strings live
// in `<lang>.db.json` (i18next `db` namespace, no `db` wrapper key).
// ------------------------------------------------------------
function loadBase(lang) {
  const p = join(LOCALES_DIR, `${lang}.json`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function loadDb(lang) {
  const p = join(LOCALES_DIR, `${lang}.db.json`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function saveBase(lang, doc) {
  const p = join(LOCALES_DIR, `${lang}.json`);
  const sorted = sortKeysStable(doc);
  writeFileSync(p, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

function saveDb(lang, doc) {
  const p = join(LOCALES_DIR, `${lang}.db.json`);
  const sorted = sortKeysStable(doc);
  writeFileSync(p, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

function sortKeysStable(v) {
  if (Array.isArray(v)) return v.map(sortKeysStable);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeysStable(v[k]);
    return out;
  }
  return v;
}

// ------------------------------------------------------------
// Diff. The English locale is the reference for text; other
// locales are checked only for id existence, not text — we
// never overwrite translator work.
// ------------------------------------------------------------
function diff(dbRows, locale, namespace, nameField) {
  const ns = locale[namespace] || {};
  const issues = { missing: [], stale: [], textMismatch: [] };
  const seen = new Set();

  for (const [id, row] of dbRows) {
    seen.add(id);
    if (!ns[id]) {
      issues.missing.push({ id, name: row.name, description: row.description });
      continue;
    }
    // Check the English locale's text matches the dump.
    if (locale.__lang === EN_KEY) {
      const curName = ns[id][nameField];
      const curDesc = ns[id].description;
      if (curName !== row.name || curDesc !== row.description) {
        issues.textMismatch.push({
          id,
          name: { from: curName, to: row.name },
          description: { from: curDesc, to: row.description },
        });
      }
    }
  }
  for (const id of Object.keys(ns)) {
    if (!seen.has(id)) issues.stale.push(id);
  }
  return issues;
}

// ------------------------------------------------------------
// --fix: rewrite the locale files.
// ------------------------------------------------------------
function applyFix(dbRows, locales, namespace, nameField) {
  let dirty = false;

  for (const locale of locales) {
    if (!locale.dbDoc[namespace]) locale.dbDoc[namespace] = {};

    const ns = locale.dbDoc[namespace];
    const isEnglish = locale.lang === EN_KEY;

    // 1) Add missing entries. English gets the dump text verbatim;
    //    other locales get the English text as a placeholder only if
    //    they don't already have any value.
    for (const [id, row] of dbRows) {
      if (ns[id]) continue;
      ns[id] = {
        [nameField]: row.name,
        ...(row.description ? { description: row.description } : {}),
      };
      if (!isEnglish) {
        // Other locales: copy the English value as a fallback so the
        // UI doesn't render the id. A future translator can replace it.
        // (This matches what createSpecialEvent.mjs does inline.)
      }
      dirty = true;
    }

    // 2) Update English text where it drifted from the dump.
    if (isEnglish) {
      for (const [id, row] of dbRows) {
        const cur = ns[id];
        if (!cur) continue;
        if (cur[nameField] !== row.name) {
          cur[nameField] = row.name;
          dirty = true;
        }
        if ((cur.description || '') !== (row.description || '')) {
          if (row.description) cur.description = row.description;
          else delete cur.description;
          dirty = true;
        }
      }
    }

    // 3) Prune stale keys (no longer in the dump).
    for (const id of Object.keys(ns)) {
      if (!dbRows.has(id)) {
        delete ns[id];
        dirty = true;
      }
    }
  }

  return dirty;
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------
function main() {
  const mode = FIX ? 'fix' : 'check';

  // Load all dumps + all locales.
  const dbByNamespace = new Map();
  for (const src of SOURCES) {
    const sqlPath = resolve(REPO_ROOT, src.file);
    let text;
    try {
      text = readFileSync(sqlPath, 'utf8');
    } catch (e) {
      console.error(`[${mode}] cannot read dump file: ${src.file}`);
      console.error(`        ${e.message}`);
      process.exit(1);
    }
    const rows = parseDump(text, src.nameField);
    if (rows.size === 0) {
      console.warn(`[${mode}] warning: ${src.file} parsed 0 rows; double-check format`);
    }
    dbByNamespace.set(src.namespace, rows);
  }

  const locales = LANG_KEYS.map((lang) => ({
    lang,
    doc: loadBase(lang),
    dbDoc: loadDb(lang),
  }));

  // Legacy guard: `db.*` must not live in the base files anymore — it moved
  // to `<lang>.db.json`. Report as drift in check mode, strip in fix mode.
  let legacyDrift = false;
  for (const locale of locales) {
    if (locale.doc.db) {
      legacyDrift = true;
      if (CHECK) {
        console.error(`  [${locale.lang}] legacy db.* section still present in ${locale.lang}.json (must live in ${locale.lang}.db.json)`);
      }
    }
  }

  // Per-namespace parity check against the *.db.json docs.
  let drift = legacyDrift;
  const allIssues = [];
  for (const src of SOURCES) {
    const dbRows = dbByNamespace.get(src.namespace);
    for (const locale of locales) {
      const issues = diff(dbRows, { ...locale.dbDoc, __lang: locale.lang }, src.namespace, src.nameField);
      const total = issues.missing.length + issues.stale.length + issues.textMismatch.length;
      if (total === 0) continue;
      drift = true;
      allIssues.push({ lang: locale.lang, ns: src.namespace, issues });
    }
  }

  if (CHECK) {
    if (!drift) {
      console.log(`i18n:check OK (${dbByNamespace.get('achievements').size} achievements, ${dbByNamespace.get('storeItems').size} store items, ${dbByNamespace.get('specialEvents').size} special events)`);
      return;
    }
    console.error('i18n:check FAILED — drift between dump files and locale db files:');
    for (const { lang, ns, issues } of allIssues) {
      if (issues.missing.length) {
        console.error(`  [${lang}] ${ns} missing: ${issues.missing.length} (e.g. ${issues.missing.slice(0, 3).map((m) => m.id).join(', ')})`);
      }
      if (issues.stale.length) {
        console.error(`  [${lang}] ${ns} stale: ${issues.stale.length} (e.g. ${issues.stale.slice(0, 3).join(', ')})`);
      }
      if (issues.textMismatch.length) {
        console.error(`  [${lang}] ${ns} text-mismatch: ${issues.textMismatch.length} (e.g. ${issues.textMismatch.slice(0, 3).map((m) => m.id).join(', ')})`);
      }
    }
    console.error('\nRun `npm run i18n:fix` to converge.');
    process.exit(1);
  }

  // --fix path.
  let anyDirty = false;
  for (const src of SOURCES) {
    const dbRows = dbByNamespace.get(src.namespace);
    const dirty = applyFix(dbRows, locales, src.namespace, src.nameField);
    if (dirty) anyDirty = true;
  }
  for (const locale of locales) {
    if (locale.doc.db) {
      delete locale.doc.db;
      saveBase(locale.lang, locale.doc);
      anyDirty = true;
    }
  }
  if (!anyDirty) {
    console.log('i18n:fix — already in sync, no changes written.');
    return;
  }
  for (const locale of locales) saveDb(locale.lang, locale.dbDoc);
  console.log(`i18n:fix — wrote ${LANG_KEYS.length} locale db files. Re-run \`npm run i18n:check\` to confirm parity.`);
}

main();
