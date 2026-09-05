import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENT_PLACEHOLDER,
  clearAchievementImagePreloads,
  getCachedAchievementImageUrl,
  preloadAchievementImage,
} from './achievementImage.js';

const OriginalImage = globalThis.Image;

afterEach(() => {
  clearAchievementImagePreloads();
  if (OriginalImage === undefined) delete globalThis.Image;
  else globalThis.Image = OriginalImage;
});

test('reuses a completed achievement image preload', async () => {
  let loads = 0;
  globalThis.Image = class {
    set src(value) {
      this.url = value;
      loads++;
      queueMicrotask(() => this.onload());
    }
  };

  const url = 'https://example.test/achievement.png';
  assert.equal(getCachedAchievementImageUrl(url), null);
  assert.equal(await preloadAchievementImage(url), url);
  assert.equal(getCachedAchievementImageUrl(url), url);
  assert.equal(await preloadAchievementImage(url), url);
  assert.equal(loads, 1);
});

test('deduplicates concurrent achievement image loads', async () => {
  let loads = 0;
  globalThis.Image = class {
    set src(value) {
      this.url = value;
      loads++;
      queueMicrotask(() => this.onload());
    }
  };

  const url = 'https://example.test/achievement.png';
  const results = await Promise.all([preloadAchievementImage(url), preloadAchievementImage(url)]);
  assert.deepEqual(results, [url, url]);
  assert.equal(loads, 1);
});

test('caches the placeholder after an image failure', async () => {
  globalThis.Image = class {
    set src(value) {
      this.url = value;
      queueMicrotask(() => this.onerror());
    }
  };

  const url = 'https://example.test/missing.png';
  assert.equal(await preloadAchievementImage(url), ACHIEVEMENT_PLACEHOLDER);
  assert.equal(getCachedAchievementImageUrl(url), ACHIEVEMENT_PLACEHOLDER);
});

test('clearing achievement image preloads removes completed results', async () => {
  globalThis.Image = class {
    set src(value) {
      this.url = value;
      queueMicrotask(() => this.onload());
    }
  };

  const url = 'https://example.test/achievement.png';
  await preloadAchievementImage(url);
  clearAchievementImagePreloads();
  assert.equal(getCachedAchievementImageUrl(url), null);
});