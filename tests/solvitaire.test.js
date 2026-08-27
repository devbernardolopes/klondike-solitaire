// tests/solvitaire.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deal } from '../src/core/dealer.js';
import { buildSolvitaireText, cardLabel } from '../src/core/solvitaire.js';

// Re-read a Solvitaire export the way the Solvitaire reader does: each line is a
// deal round; the r-th line lists columns r..6. Column p across all rounds
// reconstructs pile p bottom→top.
function parseSolvitaire(text) {
  const lines = text.split('\n').filter((l) => l.length > 0);
  const header = lines[0];
  const rows = lines.slice(1, 8).map((l) => l.replace(/^\s+/, '').replace(/,$/, ''));
  const packLine = lines[8].replace(/,$/, '');
  const piles = [[], [], [], [], [], [], []];
  rows.forEach((row, r) => {
    const cells = row.split(',').filter((c) => c.length > 0);
    cells.forEach((cell, i) => {
      const p = r + i; // column index = round + position
      piles[p].push(cell);
    });
  });
  const pack = packLine.split(',').filter((c) => c.length > 0);
  return { header, piles, pack };
}

test('exposes all 52 cards as the starting deal', () => {
  const state = deal({ seed: 12345 });
  const text = buildSolvitaireText(state);
  const { header, piles, pack } = parseSolvitaire(text);

  assert.equal(header, 'klondike,1');

  const all = [...piles.flat(), ...pack];
  assert.equal(all.length, 52);
  assert.equal(new Set(all).size, 52);

  for (const label of all) {
    assert.match(label, /^(A|2|3|4|5|6|7|8|9|10|J|Q|K)[shdc]$/);
  }

  state.tableau.forEach((pile, p) => {
    const original = pile.map(cardLabel);
    assert.deepEqual(piles[p], original);
    assert.equal(pile[pile.length - 1].faceUp, true);
    if (pile.length > 1) assert.equal(pile[0].faceUp, false);
  });

  assert.deepEqual(pack, state.stock.map(cardLabel));
});

test('uses the draw count in the header', () => {
  const state = deal({ seed: 7, drawCount: 3 });
  const text = buildSolvitaireText(state);
  assert.equal(text.split('\n')[0], 'klondike,3');
});

test('works for an order-based (random) deal too', () => {
  const dealt = deal({ seed: 999 });
  const deck = dealt.stock.concat(dealt.tableau.flat());
  const state = deal({ order: deck });
  const text = buildSolvitaireText(state);
  const { piles, pack } = parseSolvitaire(text);
  const all = [...piles.flat(), ...pack];
  assert.equal(new Set(all).size, 52);
  assert.deepEqual(pack, state.stock.map(cardLabel));
});

test('includes trailing commas and 4-space per-round indentation', () => {
  const state = deal({ seed: 1 });
  const lines = buildSolvitaireText(state).split('\n').slice(1, 8);
  lines.forEach((line, r) => {
    assert.ok(line.endsWith(','));
    const leading = line.length - line.trimStart().length;
    assert.equal(leading, r * 4);
  });
});
