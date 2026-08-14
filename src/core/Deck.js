// core/Deck.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.

import { SUITS, RANKS, createCard } from './Card.js';

/**
 * Build a standard 52-card deck, all face-down by default.
 * @param {object} [opts]
 * @param {boolean} [opts.faceUp=false]
 * @returns {Array<ReturnType<typeof createCard>>}
 */
export function buildStandardDeck({ faceUp = false } = {}) {
  /** @type {Array<ReturnType<typeof createCard>>} */
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(createCard(suit, rank, { faceUp }));
    }
  }
  return deck;
}

/**
 * Mulberry32 — small, fast, deterministic PRNG so shuffles are reproducible from a seed.
 * @param {number} seed
 * @returns {() => number}  function returning float in [0, 1)
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher–Yates shuffle. Pure: returns a new array, does not mutate input.
 *
 * @param {Array<ReturnType<typeof createCard>>} deck
 * @param {number} [seed]  if omitted, a non-deterministic shuffle is used.
 * @returns {Array<ReturnType<typeof createCard>>}
 */
export function shuffle(deck, seed) {
  const out = deck.slice();
  if (seed === undefined) {
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
  } else {
    const rng = mulberry32(seed);
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}
