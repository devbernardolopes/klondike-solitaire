import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

import { generateAll, parseExistingDeals } from './generateEventSeeds.mjs';
import { solveBatch } from './lib/seedHelpers.mjs';
import { buildUsedSet } from './generateDaily.mjs';
import { findSolverBinary } from './generateSolvablePool.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_CATALOG = join(__dirname, 'eventCatalog.src.json');
const DEFAULT_OUT = join(__dirname, 'eventSeeds.sql');
const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'pt-BR'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const BUCKET = 'event-images';

function parseArgs(argv) {
  const opts = {
    page: [],
    dryRun: false,
    force: false,
    skipDb: false,
    skipImages: false,
    nonInteractive: false,
    help: false,
    catalog: DEFAULT_CATALOG,
    out: DEFAULT_OUT,
  };
  const single = {
    '--id': 'id',
    '--title': 'title',
    '--description': 'description',
    '--starts-at': 'startsAt',
    '--sort-order': 'sortOrder',
    '--game-kind': 'gameKind',
    '--image-dir': 'imageDir',
    '--catalog': 'catalog',
    '--out': 'out',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--page') {
      const v = argv[++i];
      if (v === undefined) throw new Error('--page requires a value');
      opts.page.push(v);
    } else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--skip-db') opts.skipDb = true;
    else if (a === '--skip-images') opts.skipImages = true;
    else if (a === '--non-interactive') opts.nonInteractive = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (single[a]) {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} requires a value`);
      opts[single[a]] = v;
    } else {
      throw new Error(`Unknown argument: ${a} (see --help)`);
    }
  }
  return opts;
}

function validateEventId(id, existingIds) {
  const v = String(id || '').trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) {
    throw new Error(`Invalid event id "${id}": use kebab-case, e.g. my-event-2026`);
  }
  if (existingIds && existingIds.has(v)) {
    throw new Error(`Event id "${v}" already exists in the catalog`);
  }
  return v;
}

function normalizeStartsAt(input) {
  const v = String(input || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    const t = Date.UTC(y, m - 1, d);
    const dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      throw new Error(`Invalid calendar date: "${input}"`);
    }
    return `${v}T00:00:00Z`;
  }
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new Error(`Invalid start date: "${input}" (use YYYY-MM-DD or full ISO)`);
  return new Date(t).toISOString().replace('.000Z', 'Z');
}

function dealsToGridSize(deals) {
  const n = Number(deals);
  if (!Number.isInteger(n)) throw new Error(`Deal count must be an integer, got "${deals}"`);
  const g = Math.sqrt(n);
  if (!Number.isInteger(g) || g < 2 || g > 6) {
    throw new Error(`Deal count must be a perfect square 4..36 (2x2..6x6), got "${deals}"`);
  }
  return g;
}

function parsePageFlag(str) {
  const raw = {};
  const tokens = String(str).split(/[\s,]+/).filter(Boolean);
  for (const tok of tokens) {
    const eq = tok.indexOf('=');
    if (eq === -1) {
      if (/^\d+$/.test(tok)) raw.gridSize = Number(tok);
      else raw.imageFile = tok;
      continue;
    }
    const k = tok.slice(0, eq).toLowerCase();
    const v = tok.slice(eq + 1);
    if (k === 'grid' || k === 'gridsize' || k === 'grid_size') raw.gridSize = Number(v);
    else if (k === 'deals') raw.deals = Number(v);
    else if (k === 'image' || k === 'imagefile' || k === 'file') raw.imageFile = v;
    else if (k === 'coins' || k === 'coinreward' || k === 'coin_reward' || k === 'reward') raw.coinReward = Number(v);
    else throw new Error(`Unknown --page key "${k}" in "${str}"`);
  }
  return raw;
}

function contentTypeForExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.png') return 'image/png';
  if (e === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function defaultImagePath(eventId, pageNumber, localFile) {
  let ext = '.jpg';
  if (localFile) {
    const e = extname(localFile).toLowerCase();
    if (IMAGE_EXTS.includes(e)) ext = e === '.jpeg' ? '.jpg' : e;
  }
  return `${eventId}/page${pageNumber}${ext}`;
}

function findImageInDir(dir, pageNumber) {
  for (const e of IMAGE_EXTS) {
    const p = join(dir, `page${pageNumber}${e}`);
    if (existsSync(p)) return p;
  }
  return null;
}

function resolvePages(rawPages, { eventId, imageDir }) {
  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    throw new Error('At least one page is required');
  }
  return rawPages.map((raw, i) => {
    const pageNumber = i + 1;
    let gridSize = raw.gridSize;
    if (raw.deals !== undefined && raw.deals !== null && raw.deals !== '') {
      gridSize = dealsToGridSize(raw.deals);
    }
    if (gridSize === undefined || gridSize === null || gridSize === '') {
      throw new Error(`Page ${pageNumber}: provide grid=N (2..6) or deals=N (4, 9, 16, 25, 36)`);
    }
    gridSize = Number(gridSize);
    let imageFile = raw.imageFile || null;
    if (!imageFile && imageDir) imageFile = findImageInDir(imageDir, pageNumber);
    const coinReward = raw.coinReward === undefined || raw.coinReward === null || raw.coinReward === ''
      ? 50
      : Number(raw.coinReward);
    return {
      pageNumber,
      gridSize,
      imageFile,
      imagePath: raw.imagePath || defaultImagePath(eventId, pageNumber, imageFile),
      coinReward,
    };
  });
}

function validatePages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('At least one page is required');
  for (const p of pages) {
    if (!Number.isInteger(p.gridSize) || p.gridSize < 2 || p.gridSize > 6) {
      throw new Error(`Page ${p.pageNumber}: gridSize must be an integer 2..6, got "${p.gridSize}"`);
    }
    if (!p.imagePath || typeof p.imagePath !== 'string') {
      throw new Error(`Page ${p.pageNumber}: imagePath is required`);
    }
    if (!Number.isInteger(p.coinReward) || p.coinReward < 0) {
      throw new Error(`Page ${p.pageNumber}: coinReward must be an integer >= 0, got "${p.coinReward}"`);
    }
  }
  return pages;
}

function buildCatalogEntry({ id, title, description, startsAt, gameKind, sortOrder, pages }) {
  const entry = {
    id,
    title,
    ...(description ? { description } : {}),
    startsAt,
    gameKind,
    sortOrder,
    pages: pages.map((p) => ({
      gridSize: p.gridSize,
      imagePath: p.imagePath,
      coinReward: p.coinReward,
    })),
  };
  return entry;
}

function updateLocaleDoc(doc, eventId, { title, description }) {
  if (!doc.db || typeof doc.db !== 'object') doc.db = {};
  if (!doc.db.specialEvents || typeof doc.db.specialEvents !== 'object') doc.db.specialEvents = {};
  doc.db.specialEvents[eventId] = {
    title,
    ...(description ? { description } : {}),
  };
  return doc;
}

function bumpPatchVersion(version) {
  const parts = String(version).split('.').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
    throw new Error(`Cannot bump version "${version}": expected semver x.y.z`);
  }
  parts[2] += 1;
  return parts.join('.');
}

function extractEventSeeds(sqlText, eventId) {
  const out = [];
  const dealRegex = /insert into special_event_deals\b([\s\S]*?)where event_id = '([^']+)' and page_number = (\d+);/gi;
  const header = /select id, unnest\(array\[([^\]]+)\]\), unnest\(array\[([^\]]+)\]::bigint\[\]\)/i;
  let m;
  while ((m = dealRegex.exec(sqlText)) !== null) {
    if (m[2] !== eventId) continue;
    const arrays = header.exec(m[1]);
    const seeds = arrays
      ? arrays[2].split(',').map((t) => Number(t.trim())).filter((n) => Number.isInteger(n))
      : [];
    out.push({ pageNumber: parseInt(m[3], 10), seeds });
  }
  out.sort((a, b) => a.pageNumber - b.pageNumber);
  return out;
}

function loadJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function printHelp() {
  console.log(`createSpecialEvent.mjs — author a Special Event end-to-end.

Usage:
  node scripts/createSpecialEvent.mjs [flags]
  npm run event:new -- [flags]

Any missing value is prompted interactively, unless --non-interactive is set.

Flags:
  --id <kebab-id>            Event id, e.g. valentines-day-2026
  --title <text>             Display title
  --description <text>       Optional (omit for none)
  --starts-at <date>         YYYY-MM-DD or full ISO, e.g. 2026-02-14
  --sort-order <n>           Display order (lower = earlier)
  --game-kind <kind>         draw-1 or draw-3 (default: draw-1)
  --page "<spec>"            Repeatable, one per page. Spec keys:
                               grid=N (2..6) | deals=N (4,9,16,25,36)
                               image=<local file>  coins=<n>
                             Example: --page "deals=4 image=./p1.jpg coins=50"
  --image-dir <dir>          Auto-map pageN.jpg/png/webp per page
  --catalog <path>           Catalog JSON (default: scripts/eventCatalog.src.json)
  --out <path>               Output SQL (default: scripts/eventSeeds.sql)
  --dry-run                  Validate + print plan, write nothing, touch no DB
  --force                    Overwrite existing event / re-upload images
  --skip-db                  Skip Supabase upserts (files only)
  --skip-images              Skip image upload (and existence check)
  --non-interactive          Error on missing values instead of prompting
  --help, -h                 This text

Env (required unless --skip-db or --dry-run):
  SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

Sequence: catalog -> solvable seeds (--resume-preserving SQL) -> locales (6x)
  -> version bump -> Supabase upserts -> image uploads -> test run.`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (label, def) => {
    if (opts.nonInteractive) {
      if (def !== undefined && def !== null && def !== '') return String(def);
      throw new Error(`Missing required value for "${label}" (non-interactive mode)`);
    }
    const suffix = def !== undefined && def !== null && def !== '' ? ` [${def}]` : '';
    const ans = (await rl.question(`${label}${suffix}: `)).trim();
    return ans === '' && def !== undefined ? String(def) : ans;
  };

  try {
    let catalog;
    try {
      catalog = loadJsonFile(opts.catalog);
    } catch {
      throw new Error(`Cannot read catalog JSON at ${opts.catalog}`);
    }
    if (!Array.isArray(catalog)) throw new Error(`Catalog at ${opts.catalog} must be a JSON array`);
    const existingIds = new Set(catalog.map((e) => e.id));
    const maxSort = catalog.reduce((m, e) => Math.max(m, Number(e.sortOrder) || 0), 0);

    const id = validateEventId(opts.id ?? await ask('Event id (kebab-case)'), existingIds);
    const title = (opts.title ?? await ask('Title')).trim();
    if (!title) throw new Error('Title is required');
    const description = (opts.description ?? (opts.nonInteractive ? '' : await ask('Description (empty = none)'))).trim();
    const startsAt = normalizeStartsAt(opts.startsAt ?? await ask('Start date (YYYY-MM-DD)'));
    const gameKind = ((opts.gameKind ?? await ask('Game kind', 'draw-1')).trim() || 'draw-1');
    if (gameKind !== 'draw-1' && gameKind !== 'draw-3') {
      throw new Error(`gameKind must be draw-1 or draw-3, got "${gameKind}"`);
    }
    const sortOrderRaw = opts.sortOrder ?? await ask('Sort order', String(maxSort + 1));
    const sortOrder = Number(sortOrderRaw);
    if (!Number.isInteger(sortOrder)) throw new Error(`sortOrder must be an integer, got "${sortOrderRaw}"`);
    if (catalog.some((e) => Number(e.sortOrder) === sortOrder)) {
      console.error(`Warning: sortOrder ${sortOrder} is already used — continuing anyway.`);
    }

    let rawPages;
    if (opts.page.length > 0) {
      rawPages = opts.page.map(parsePageFlag);
    } else {
      const countRaw = await ask('Number of pages', '1');
      const count = Number(countRaw);
      if (!Number.isInteger(count) || count < 1) throw new Error(`Page count must be an integer >= 1, got "${countRaw}"`);
      rawPages = [];
      for (let n = 1; n <= count; n++) {
        const auto = opts.imageDir ? findImageInDir(opts.imageDir, n) : null;
        const dealsRaw = await ask(`Page ${n} deals (4, 9, 16, 25, 36)`);
        const imageFileRaw = opts.skipImages
          ? ''
          : await ask(`Page ${n} local image file${auto ? ` (found ${auto})` : ''}`, auto || '');
        const coinsRaw = await ask(`Page ${n} coin reward`, '50');
        rawPages.push({
          deals: Number(dealsRaw),
          imageFile: imageFileRaw.trim() === '' ? null : imageFileRaw.trim(),
          coinReward: Number(coinsRaw),
        });
      }
    }
    const pages = validatePages(resolvePages(rawPages, { eventId: id, imageDir: opts.imageDir || null }));
    const totalDeals = pages.reduce((s, p) => s + p.gridSize * p.gridSize, 0);

    if (!opts.skipImages) {
      for (const p of pages) {
        if (!p.imageFile) throw new Error(`Page ${p.pageNumber}: no local image file (use --image-dir, --page image=... or --skip-images)`);
        if (!existsSync(p.imageFile)) throw new Error(`Page ${p.pageNumber}: image file not found: ${p.imageFile}`);
        const e = extname(p.imageFile).toLowerCase();
        if (!IMAGE_EXTS.includes(e)) throw new Error(`Page ${p.pageNumber}: unsupported image extension "${e}" (use .jpg/.png/.webp)`);
      }
    }

    const needsDb = !opts.skipDb && !opts.dryRun;
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    let supabase = null;
    if (needsDb) {
      if (!supabaseUrl || !serviceKey) {
        throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY in env (or use --skip-db / --dry-run)');
      }
      supabase = createClient(supabaseUrl, serviceKey);
      const { data: existing, error: existErr } = await supabase
        .from('special_events')
        .select('id')
        .eq('id', id)
        .maybeSingle();
      if (existErr) throw new Error(`Supabase existence check failed: ${existErr.message}`);
      if (existing && !opts.force) {
        throw new Error(`Event "${id}" already exists in Supabase (use --force to overwrite)`);
      }
      if (existing && opts.force) console.error(`Warning: event "${id}" exists remotely — will overwrite (--force).`);
    }

    if (opts.dryRun) {
      console.log(`Dry run — no writes. Plan for "${id}":`);
      console.log(`  title: ${title}`);
      console.log(`  description: ${description || '(none)'}`);
      console.log(`  startsAt: ${startsAt}  gameKind: ${gameKind}  sortOrder: ${sortOrder}`);
      for (const p of pages) {
        console.log(`  page ${p.pageNumber}: ${p.gridSize}x${p.gridSize} = ${p.gridSize * p.gridSize} deals, image ${p.imageFile || '(no local file)'} -> ${p.imagePath}, coins ${p.coinReward}`);
      }
      console.log(`  total deals to generate: ${totalDeals}`);
      console.log(`  would update: catalog, eventSeeds.sql, 6 locales, package.json${opts.skipDb ? '' : ', Supabase tables + event-images bucket'}`);
      return;
    }

    const entry = buildCatalogEntry({ id, title, description, startsAt, gameKind, sortOrder, pages });
    catalog.push(entry);
    writeFileSync(opts.catalog, JSON.stringify(catalog, null, 2) + '\n');
    console.error(`Catalog updated: ${opts.catalog}`);

    const used = buildUsedSet();
    let seenPages = null;
    let preservedBlocks = null;
    if (existsSync(opts.out)) {
      const parsed = parseExistingDeals(readFileSync(opts.out, 'utf8'));
      for (const s of parsed.usedSeeds) used.add(s);
      seenPages = parsed.seenPages;
      preservedBlocks = parsed.preservedBlocks;
      console.error(`Resuming: ${parsed.usedSeeds.size} existing seeds preserved.`);
    }
    const binary = findSolverBinary();
    console.error(binary
      ? `Solver binary found: ${binary}`
      : 'No solver binary — embedded JS fallback (slow for large events).');
    console.error(`Generating ${totalDeals} solvable seeds...`);
    const { sql } = generateAll({ catalog, used, solveFn: (seeds) => solveBatch(seeds, binary), seenPages, preservedBlocks });
    const header = [
      `-- ============================================================`,
      `-- Special Event deal seeds — auto-generated by scripts/generateEventSeeds.mjs`,
      `-- Generated: ${new Date().toISOString()}`,
      `-- Solver: ${binary ? `KlondikeSolver binary (${binary})` : 'embedded JS fallback'}`,
      `-- Positions are row-major: position 1 = top-left, gridSize² = bottom-right.`,
      `-- Deal numbers are event-sequential across pages (page 1 with 4 deals owns 1-4, page 2 starts at 5).`,
      `-- Paste into: Supabase Dashboard > SQL Editor > Run`,
      `-- ============================================================`,
      '',
    ].join('\n');
    const fullSql = `${header}\n${sql}\n`;
    writeFileSync(opts.out, fullSql);
    console.error(`SQL written: ${opts.out}`);
    const newSeeds = extractEventSeeds(fullSql, id);
    const seededTotal = newSeeds.reduce((s, p) => s + p.seeds.length, 0);
    if (seededTotal !== totalDeals) {
      throw new Error(`Seed count mismatch for "${id}": expected ${totalDeals}, got ${seededTotal}`);
    }

    for (const locale of LOCALES) {
      const lp = join(ROOT, 'src', 'i18n', 'locales', `${locale}.json`);
      const doc = loadJsonFile(lp);
      updateLocaleDoc(doc, id, { title, description });
      writeFileSync(lp, JSON.stringify(doc, null, 2) + '\n');
    }
    console.error(`Locales updated: ${LOCALES.join(', ')}`);

    const pkgPath = join(ROOT, 'package.json');
    const pkg = loadJsonFile(pkgPath);
    pkg.version = bumpPatchVersion(pkg.version);
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.error(`Version bumped: ${pkg.version}`);

    if (supabase) {
      const { error: evErr } = await supabase.from('special_events').upsert(
        {
          id,
          title,
          description: description || null,
          enabled: true,
          starts_at: startsAt,
          game_kind: gameKind,
          sort_order: sortOrder,
        },
        { onConflict: 'id' },
      );
      if (evErr) throw new Error(`special_events upsert failed: ${evErr.message}`);
      console.error('Upserted: special_events');

      const pageRows = pages.map((p) => ({
        event_id: id,
        page_number: p.pageNumber,
        grid_size: p.gridSize,
        image_path: p.imagePath,
        coin_reward: p.coinReward,
      }));
      const { error: pgErr } = await supabase
        .from('special_event_pages')
        .upsert(pageRows, { onConflict: 'event_id,page_number' });
      if (pgErr) throw new Error(`special_event_pages upsert failed: ${pgErr.message}`);
      console.error('Upserted: special_event_pages');

      const { data: pageData, error: pgSelErr } = await supabase
        .from('special_event_pages')
        .select('id,page_number')
        .eq('event_id', id);
      if (pgSelErr) throw new Error(`special_event_pages select failed: ${pgSelErr.message}`);
      const pageIdByNumber = new Map((pageData || []).map((r) => [r.page_number, r.id]));

      const dealRows = [];
      // Event-sequential Deal N across pages (page 1 with 4 deals owns 1-4,
      // so page 2 starts at 5). newSeeds is page-sorted by extractEventSeeds.
      let dealNumber = 0;
      for (const pg of newSeeds) {
        const pageId = pageIdByNumber.get(pg.pageNumber);
        if (!pageId) throw new Error(`No page id returned for page ${pg.pageNumber}`);
        pg.seeds.forEach((seed, i) => dealRows.push({ page_id: pageId, position: i + 1, seed, deal_number: dealNumber + i + 1 }));
        dealNumber += pg.seeds.length;
      }
      for (let i = 0; i < dealRows.length; i += 500) {
        const { error: dErr } = await supabase
          .from('special_event_deals')
          .upsert(dealRows.slice(i, i + 500), { onConflict: 'page_id,position' });
        if (dErr) throw new Error(`special_event_deals upsert failed: ${dErr.message}`);
      }
      console.error(`Upserted: special_event_deals (${dealRows.length})`);

      if (!opts.skipImages) {
        for (const p of pages) {
          const buf = readFileSync(p.imageFile);
          const { error: upErr } = await supabase.storage
            .from(BUCKET)
            .upload(p.imagePath, buf, { upsert: opts.force, contentType: contentTypeForExt(extname(p.imageFile)) });
          if (upErr) throw new Error(`Image upload failed for ${p.imagePath}: ${upErr.message}`);
          console.error(`Uploaded: ${BUCKET}/${p.imagePath}`);
        }
      }
    }

    try {
      execFileSync('node', ['--test', 'src/core/features.test.js'], { cwd: ROOT, stdio: 'pipe' });
      console.error('Tests passed: src/core/features.test.js');
    } catch {
      console.error('Warning: src/core/features.test.js failed — run it manually and inspect.');
    }

    console.log(`Done. Event "${id}" (${title}): ${pages.length} page(s), ${totalDeals} deals, version ${pkg.version}.`);
    console.log(`Suggested commit:`);
    console.log(``);
    console.log(`feat(events): add "${title}" special event with ${totalDeals} deals across ${pages.length} page(s)`);
    console.log(``);
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

export {
  parseArgs,
  validateEventId,
  normalizeStartsAt,
  dealsToGridSize,
  parsePageFlag,
  contentTypeForExt,
  defaultImagePath,
  resolvePages,
  validatePages,
  buildCatalogEntry,
  updateLocaleDoc,
  bumpPatchVersion,
  extractEventSeeds,
};
