import assert from 'node:assert/strict';
import test from 'node:test';
import { eventDealTitle } from './eventDealTitle.js';

// Minimal t() stub: interpolates {{var}} placeholders like i18next.
const t = (key, opts = {}) => {
  const templates = {
    'history.eventDeal': '{{title}}, Deal {{dealNumber}}',
    'history.dailyDeal': 'Daily Challenge, {{date}}',
    'history.kinds.daily': 'Daily Challenge',
    'history.kinds.winning': 'Winning Deal',
    'history.kinds.unknown': 'Unknown Deal',
  };
  const template = templates[key] ?? opts.defaultValue ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => String(opts[name] ?? ''));
};

test('event entries render title + deal number', () => {
  assert.equal(
    eventDealTitle({ gameKind: 'event', eventTitle: 'Autumn Cup', eventDealNumber: 4 }, t),
    'Autumn Cup, Deal 4',
  );
});

test('daily entries with a date render the date', () => {
  assert.equal(
    eventDealTitle({ gameKind: 'daily', dailyDate: '2026-08-08' }, t),
    'Daily Challenge, 2026-08-08',
  );
});

test('daily entries without a date fall back to the kind label', () => {
  assert.equal(eventDealTitle({ gameKind: 'daily', dailyDate: null }, t), 'Daily Challenge');
  assert.equal(eventDealTitle({ gameKind: 'daily' }, t), 'Daily Challenge');
});

test('other kinds and unknown entries are unchanged', () => {
  assert.equal(eventDealTitle({ gameKind: 'winning' }, t), 'Winning Deal');
  assert.equal(eventDealTitle({ gameKind: null }, t), 'Unknown Deal');
  assert.equal(eventDealTitle(null, t), 'Unknown Deal');
});
