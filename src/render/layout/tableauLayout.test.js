import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TABLEAU_LAYOUT,
  computeTableauFan,
  computeAvailBudget,
  resolveTableauMins,
  tableauTransition,
} from './tableauLayout.js';

const up = (id) => ({ id, faceUp: true });
const down = (id) => ({ id, faceUp: false });

test('no compression under budget keeps max fans', () => {
  const cards = [down('a'), up('b'), up('c')];
  const r = computeTableauFan(cards, {
    cardH: 100, fanUpMax: 40, fanDownMax: 20, downMin: 3, upEmergencyMin: 8, avail: 500,
  });
  assert.equal(r.fanDown, 20);
  assert.equal(r.fanUp, 40);
  assert.deepEqual(r.tops, [0, 20, 60]);
  assert.equal(r.pileHeight, 160);
});

test('over budget pins face-down to floor and compresses face-up', () => {
  const cards = [down('a'), up('b'), up('c')];
  const r = computeTableauFan(cards, {
    cardH: 100, fanUpMax: 40, fanDownMax: 20, downMin: 3, upEmergencyMin: 8, avail: 30,
  });
  assert.equal(r.fanDown, 3);
  assert.equal(r.fanUp, 27);
  assert.deepEqual(r.tops, [0, 3, 30]);
  assert.equal(r.pileHeight, 130);
});

test('face-up floor clamps when pile far exceeds budget', () => {
  const cards = [up('a'), up('b'), up('c'), up('d'), up('e')];
  const r = computeTableauFan(cards, {
    cardH: 100, fanUpMax: 40, fanDownMax: 20, downMin: 3, upEmergencyMin: 8, avail: 10,
  });
  assert.equal(r.fanUp, 8);
  assert.equal(r.pileHeight, 100 + 4 * 8);
});

test('empty and single-card piles', () => {
  assert.deepEqual(computeTableauFan([], {
    cardH: 100, fanUpMax: 40, fanDownMax: 20, downMin: 3, upEmergencyMin: 8, avail: 50,
  }).tops, []);
  const single = computeTableauFan([up('a')], {
    cardH: 100, fanUpMax: 40, fanDownMax: 20, downMin: 3, upEmergencyMin: 8, avail: 50,
  });
  assert.deepEqual(single.tops, [0]);
  assert.equal(single.pileHeight, 100);
});

test('does not mutate input', () => {
  const cards = [down('a'), up('b')];
  const snapshot = JSON.stringify(cards);
  computeTableauFan(cards, {
    cardH: 100, fanUpMax: 40, fanDownMax: 20, downMin: 3, upEmergencyMin: 8, avail: 5,
  });
  assert.equal(JSON.stringify(cards), snapshot);
});

test('avail budget mirrors Board formula', () => {
  assert.equal(
    computeAvailBudget({ boardH: 800, cardH: 100, gap: 10, pad: 20, frame: 0, boardFrame: false }),
    800 - 200 - 10 - 40 - 0 - 0 - TABLEAU_LAYOUT.budget.reservePx,
  );
  assert.equal(
    computeAvailBudget({ boardH: 800, cardH: 100, gap: 10, pad: 20, frame: 5, boardFrame: true }),
    800 - 200 - 10 - 40 - 10 - TABLEAU_LAYOUT.budget.frameMarginPx - TABLEAU_LAYOUT.budget.reservePx,
  );
});

test('tuning override wins over measured, measured over fallback', () => {
  const prev = { ...TABLEAU_LAYOUT.tuning };
  try {
    TABLEAU_LAYOUT.tuning.fanDownMinOverride = 12;
    TABLEAU_LAYOUT.tuning.fanUpEmergencyMinOverride = 14;
    assert.deepEqual(resolveTableauMins({ fanDownMin: 3, fanUpEmergencyMin: 8 }), { downMin: 12, upEmergencyMin: 14 });
    TABLEAU_LAYOUT.tuning.fanDownMinOverride = null;
    TABLEAU_LAYOUT.tuning.fanUpEmergencyMinOverride = null;
    assert.deepEqual(resolveTableauMins({ fanDownMin: 5, fanUpEmergencyMin: 9 }), { downMin: 5, upEmergencyMin: 9 });
    assert.deepEqual(resolveTableauMins({}), {
      downMin: TABLEAU_LAYOUT.fallbacks.fanDownMin,
      upEmergencyMin: TABLEAU_LAYOUT.fallbacks.fanUpEmergencyMin,
    });
  } finally {
    Object.assign(TABLEAU_LAYOUT.tuning, prev);
  }
});

test('transition string follows smooth config', () => {
  assert.equal(
    tableauTransition('top'),
    `top ${TABLEAU_LAYOUT.smooth.duration}s ${TABLEAU_LAYOUT.smooth.ease}`,
  );
});
