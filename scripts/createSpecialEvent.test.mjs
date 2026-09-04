import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
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
} from './createSpecialEvent.mjs';

test('parseArgs collects flags, repeatable --page, and booleans', () => {
  const o = parseArgs(['--id', 'evt-1', '--title', 'Evt', '--page', 'deals=4 image=a.jpg coins=50', '--page', 'grid=3', '--dry-run', '--force']);
  assert.equal(o.id, 'evt-1');
  assert.deepEqual(o.page, ['deals=4 image=a.jpg coins=50', 'grid=3']);
  assert.equal(o.dryRun, true);
  assert.equal(o.force, true);
  assert.equal(o.skipDb, false);
});

test('parseArgs rejects unknown arguments', () => {
  assert.throws(() => parseArgs(['--nope']), /Unknown argument/);
});

test('validateEventId accepts kebab-case and rejects bad or duplicate ids', () => {
  assert.equal(validateEventId('valentines-day-2026', new Set()), 'valentines-day-2026');
  assert.throws(() => validateEventId('Valentines Day', new Set()), /kebab-case/);
  assert.throws(() => validateEventId('', new Set()), /kebab-case/);
  assert.throws(() => validateEventId('evt', new Set(['evt'])), /already exists/);
});

test('normalizeStartsAt handles date-only, full ISO, and invalid input', () => {
  assert.equal(normalizeStartsAt('2026-02-14'), '2026-02-14T00:00:00Z');
  assert.equal(normalizeStartsAt('2026-02-14T00:00:00Z'), '2026-02-14T00:00:00Z');
  assert.throws(() => normalizeStartsAt('2026-02-30'), /Invalid calendar date/);
  assert.throws(() => normalizeStartsAt('not-a-date'), /Invalid start date/);
});

test('dealsToGridSize maps perfect squares and rejects the rest', () => {
  assert.equal(dealsToGridSize(4), 2);
  assert.equal(dealsToGridSize(9), 3);
  assert.equal(dealsToGridSize(36), 6);
  assert.throws(() => dealsToGridSize(5), /perfect square/);
  assert.throws(() => dealsToGridSize(49), /perfect square/);
  assert.throws(() => dealsToGridSize(1), /perfect square/);
});

test('parsePageFlag understands key=value pairs and bare grid sizes', () => {
  assert.deepEqual(parsePageFlag('deals=4 image=a.jpg coins=50'), { deals: 4, imageFile: 'a.jpg', coinReward: 50 });
  assert.deepEqual(parsePageFlag('grid=3'), { gridSize: 3 });
  assert.deepEqual(parsePageFlag('3'), { gridSize: 3 });
  assert.throws(() => parsePageFlag('bogus=1'), /Unknown --page key/);
});

test('resolvePages maps deals to grids, defaults coins and image paths', () => {
  const pages = resolvePages(
    [{ deals: 4, imageFile: 'photo.JPG', coinReward: 50 }, { gridSize: 3 }],
    { eventId: 'evt', imageDir: null },
  );
  assert.equal(pages[0].gridSize, 2);
  assert.equal(pages[0].imagePath, 'evt/page1.jpg');
  assert.equal(pages[1].gridSize, 3);
  assert.equal(pages[1].imagePath, 'evt/page2.jpg');
  assert.equal(pages[1].coinReward, 50);
  assert.throws(() => resolvePages([], { eventId: 'evt', imageDir: null }), /At least one page/);
});

test('validatePages enforces grid range, image path, and coin reward', () => {
  const good = [{ pageNumber: 1, gridSize: 2, imagePath: 'e/page1.jpg', coinReward: 0 }];
  assert.deepEqual(validatePages(good), good);
  assert.throws(() => validatePages([{ pageNumber: 1, gridSize: 7, imagePath: 'x', coinReward: 0 }]), /gridSize/);
  assert.throws(() => validatePages([{ pageNumber: 1, gridSize: 2, imagePath: '', coinReward: 0 }]), /imagePath/);
  assert.throws(() => validatePages([{ pageNumber: 1, gridSize: 2, imagePath: 'x', coinReward: -1 }]), /coinReward/);
});

test('contentTypeForExt and defaultImagePath handle extensions', () => {
  assert.equal(contentTypeForExt('.jpg'), 'image/jpeg');
  assert.equal(contentTypeForExt('.png'), 'image/png');
  assert.equal(defaultImagePath('evt', 2, 'pic.PNG'), 'evt/page2.png');
  assert.equal(defaultImagePath('evt', 1, null), 'evt/page1.jpg');
});

test('buildCatalogEntry omits empty descriptions', () => {
  const withDesc = buildCatalogEntry({ id: 'a', title: 'A', description: 'Hi', startsAt: '2026-01-01T00:00:00Z', gameKind: 'draw-1', sortOrder: 1, pages: [{ gridSize: 2, imagePath: 'a/p.jpg', coinReward: 50 }] });
  assert.equal(withDesc.description, 'Hi');
  const without = buildCatalogEntry({ id: 'a', title: 'A', description: '', startsAt: '2026-01-01T00:00:00Z', gameKind: 'draw-1', sortOrder: 1, pages: [] });
  assert.ok(!('description' in without));
});

test('updateLocaleDoc writes title-only or title+description entries', () => {
  const doc = updateLocaleDoc({ db: { specialEvents: {} } }, 'evt', { title: 'Evt', description: '' });
  assert.deepEqual(doc.db.specialEvents.evt, { title: 'Evt' });
  const doc2 = updateLocaleDoc({}, 'evt', { title: 'Evt', description: 'Desc' });
  assert.deepEqual(doc2.db.specialEvents.evt, { title: 'Evt', description: 'Desc' });
});

test('bumpPatchVersion increments patch and rejects non-semver', () => {
  assert.equal(bumpPatchVersion('0.0.444'), '0.0.445');
  assert.throws(() => bumpPatchVersion('1.2'), /semver/);
});

test('extractEventSeeds pulls per-page seeds for one event only', () => {
  const sql = [
    `insert into special_event_deals (page_id, "position", seed)`,
    `select id, unnest(array[1,2,3,4]), unnest(array[11,12,13,14]::bigint[])`,
    `  from special_event_pages`,
    `  where event_id = 'evt-a' and page_number = 1;`,
    ``,
    `insert into special_event_deals (page_id, "position", seed)`,
    `select id, unnest(array[1,2]), unnest(array[21,22]::bigint[])`,
    `  from special_event_pages`,
    `  where event_id = 'evt-b' and page_number = 1;`,
  ].join('\n');
  assert.deepEqual(extractEventSeeds(sql, 'evt-a'), [{ pageNumber: 1, seeds: [11, 12, 13, 14] }]);
  assert.deepEqual(extractEventSeeds(sql, 'evt-b'), [{ pageNumber: 1, seeds: [21, 22] }]);
  assert.deepEqual(extractEventSeeds(sql, 'missing'), []);
});
