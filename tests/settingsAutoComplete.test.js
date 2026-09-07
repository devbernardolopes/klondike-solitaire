import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const locales = ['en', 'de', 'fr', 'it', 'es', 'pt-BR'];

const load = (locale) => JSON.parse(
  readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url)),
);

for (const locale of locales) {
  test(`[${locale}] auto-complete toggle labels exist`, () => {
    const strings = load(locale);
    assert.equal(strings.settings.autoComplete, 'Auto-Complete');
    assert.ok(strings.settings['autoComplete.desc'].length > 0);
  });
}
