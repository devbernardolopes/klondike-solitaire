import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const localesDir = 'src/i18n/locales';
const langs = ['en', 'fr', 'de', 'it', 'es', 'pt-BR'];

function flatKeys(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatKeys(v, key, out);
    else out.add(key);
  }
  return out;
}

let ok = true;
const base = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8'));
const baseKeys = flatKeys(base);

for (const lang of langs) {
  const data = JSON.parse(readFileSync(join(localesDir, `${lang}.json`), 'utf8'));
  const keys = flatKeys(data);
  const missing = [...baseKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !baseKeys.has(k));
  if (missing.length || extra.length) {
    ok = false;
    console.error(`[${lang}] missing: ${missing.length} extra: ${extra.length}`);
    if (missing.length) console.error('  missing', missing.slice(0, 10));
    if (extra.length) console.error('  extra', extra.slice(0, 10));
  } else {
    console.log(`[${lang}] parity OK (${keys.size} keys)`);
  }
}

try {
  const sql = readFileSync('supabase/achievements_definitions.sql', 'utf8');
  const ids = [...sql.matchAll(/\('([^']+)',\s*'[^']+'\s*,\s*'[^']+'/g)].map((m) => m[1]);
  const distinct = [...new Set(ids)];
  const localeIds = Object.keys(base.db?.achievements || {});
  const miss = distinct.filter((id) => !localeIds.includes(id));
  const stale = localeIds.filter((id) => !distinct.includes(id));
  if (miss.length || stale.length) {
    ok = false;
    console.error(`[db.achievements] SQL distinct ${distinct.length} vs locale ${localeIds.length}`);
    if (miss.length) console.error('  missing in locale:', miss);
    if (stale.length) console.error('  stale in locale:', stale);
  } else {
    console.log(`[db.achievements] coverage OK (${distinct.length} ids)`);
  }
} catch (e) {
  console.error('achievements check failed', e.message);
  ok = false;
}

if (!ok) process.exit(1);
console.log('i18n verify passed');
