import assert from 'node:assert/strict';
import test from 'node:test';
import { copyText } from './copyText.js';

test('copyText resolves false with no clipboard or document (node)', async () => {
  assert.equal(await copyText('12345'), false);
  assert.equal(await copyText(null), false);
});
