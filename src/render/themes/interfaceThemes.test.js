import { test } from 'node:test';
import assert from 'node:assert/strict';

import { INTERFACE_THEMES, INTERFACE_THEME_IDS, isInterfaceTheme, tilePreviewOf } from './interfaceThemes.js';

test('interface theme ids are unique and include the built-ins', () => {
  assert.deepEqual([...new Set(INTERFACE_THEME_IDS)], INTERFACE_THEME_IDS);
  for (const id of ['classic', 'dark', 'hc-dark', 'hc-light', 'pastel', 'arcade']) {
    assert.ok(INTERFACE_THEME_IDS.includes(id), `missing theme: ${id}`);
  }
});

test('every interface theme has a complete tile preview', () => {
  for (const entry of INTERFACE_THEMES) {
    assert.equal(typeof entry.tile.background, 'string', `${entry.id} tile background`);
    assert.equal(typeof entry.tile.border, 'string', `${entry.id} tile border`);
    assert.equal(typeof entry.tile.color, 'string', `${entry.id} tile color`);
  }
});

test('isInterfaceTheme accepts catalog ids and rejects the rest', () => {
  assert.equal(isInterfaceTheme('classic'), true);
  assert.equal(isInterfaceTheme('arcade'), true);
  assert.equal(isInterfaceTheme('midnight'), false);
  assert.equal(isInterfaceTheme(''), false);
  assert.equal(isInterfaceTheme(null), false);
});

test('tilePreviewOf falls back to the first theme for unknown ids', () => {
  assert.deepEqual(tilePreviewOf('nope'), INTERFACE_THEMES[0].tile);
  assert.deepEqual(tilePreviewOf('pastel'), INTERFACE_THEMES.find((entry) => entry.id === 'pastel').tile);
});
