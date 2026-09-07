import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACHIEVEMENT_PLACEHOLDER,
  achievementImageUrl,
} from './achievementImage.js';
import {
  clearAchievementImageCache,
  ensureAchievementImageCached,
  getAchievementImageUrlSync,
  warmAchievementImageCache,
} from './achievementImageCache.js';

test('passes blob and data URLs through for cached toast images', () => {
  assert.equal(achievementImageUrl('blob:http://localhost/abc'), 'blob:http://localhost/abc');
  assert.equal(achievementImageUrl('data:image/png;base64,AAA'), 'data:image/png;base64,AAA');
  assert.equal(achievementImageUrl('https://example.test/a.jpg'), 'https://example.test/a.jpg');
});

test('falls back to the placeholder when offline with an empty memory cache', () => {
  clearAchievementImageCache();
  assert.equal(getAchievementImageUrlSync('won_under_30s.jpg'), ACHIEVEMENT_PLACEHOLDER);
  assert.equal(getAchievementImageUrlSync(''), ACHIEVEMENT_PLACEHOLDER);
});

test('warm and ensure degrade gracefully without IndexedDB or Supabase', async () => {
  clearAchievementImageCache();
  await warmAchievementImageCache();
  await ensureAchievementImageCached('won_under_30s.jpg');
  await ensureAchievementImageCached('');
  assert.equal(getAchievementImageUrlSync('won_under_30s.jpg'), ACHIEVEMENT_PLACEHOLDER);
  clearAchievementImageCache();
});
