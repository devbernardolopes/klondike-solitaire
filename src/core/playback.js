// core/playback.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.
//
// Playback counterpart to core/moveLog.js: parses the compact human-readable
// recording (one step per line: D / R / U / "Ah W->F1" / "7h,6s,5h T3->T6")
// back into engine moves and precomputes the linear board sequence for the
// step-through player.
//
// Resolution is by rank+suit label, NOT card id: ids are session-ephemeral
// (Card.js global counter) while labels are unique per 52-card deck. The
// moved run must be the top of the source pile (as recorded), otherwise the
// log has diverged from the rebuilt deal and parsing throws — the UI aborts
// playback with a message instead of showing a wrong board.
//
// 'U' (undo) pushes the inverted board (core undo of the current top), so
// stepping traverses exactly what the player saw: move, then board-back.

import { applyMove, undo as coreUndo, parseLocator } from './moveEngine.js';

const SUIT_OF = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };

function rankOf(token) {
  if (token === 'A') return 1;
  if (token === 'J') return 11;
  if (token === 'Q') return 12;
  if (token === 'K') return 13;
  const n = Number(token);
  if (Number.isInteger(n) && n >= 2 && n <= 10) return n;
  return null;
}

/**
 * Parse one recorded line.
 * @param {string} line
 * @returns {{ type: 'draw' } | { type: 'recycle' } | { type: 'undo' } | { type: 'moveCards', labels: string[], from: string, to: string } | null}
 */
export function parseLogLine(line) {
  if (typeof line !== 'string') return null;
  const text = line.trim();
  if (text === 'D') return { type: 'draw' };
  if (text === 'R') return { type: 'recycle' };
  if (text === 'U') return { type: 'undo' };
  const parts = text.split(' ');
  if (parts.length !== 2) return null;
  const [cardsPart, locsPart] = parts;
  const arrow = locsPart.split('->');
  if (arrow.length !== 2) return null;
  const from = expandLocator(arrow[0]);
  const to = expandLocator(arrow[1]);
  if (!from || !to) return null;
  const labels = cardsPart.split(',');
  if (labels.length === 0 || labels.some((l) => !isCardLabel(l))) return null;
  return { type: 'moveCards', labels, from, to };
}

function isCardLabel(label) {
  if (typeof label !== 'string' || label.length < 2) return false;
  const suit = label[label.length - 1];
  const rank = label.slice(0, -1);
  return SUIT_OF[suit] != null && rankOf(rank) != null;
}

/**
 * Expand a short human locator (S / W / F1-F4 / T1-T7) to canonical form.
 * @param {string} short
 * @returns {string|null}
 */
export function expandLocator(short) {
  if (short === 'S') return 'stock';
  if (short === 'W') return 'waste';
  if (typeof short !== 'string' || short.length < 2) return null;
  const kind = short[0];
  const n = Number(short.slice(1));
  if (kind === 'F' && Number.isInteger(n) && n >= 1 && n <= 4) return `foundation:${n - 1}`;
  if (kind === 'T' && Number.isInteger(n) && n >= 1 && n <= 7) return `tableau:${n - 1}`;
  return null;
}

function pileOf(state, loc) {
  const { kind, index } = parseLocator(loc);
  if (kind === 'stock') return state.stock;
  if (kind === 'waste') return state.waste;
  if (kind === 'foundation') return state.foundations[index];
  return state.tableau[index];
}

function labelMatches(card, label) {
  const suit = label[label.length - 1];
  const rank = label.slice(0, -1);
  return card.suit === SUIT_OF[suit] && card.rank === rankOf(rank);
}

/**
 * Resolve a parsed line against the CURRENT board into an engine move.
 * @param {import('./GameState.js').GameState} state  board before the step
 * @param {ReturnType<parseLogLine>} parsed
 * @returns {{ type: string, from?: string, to?: string, cardIds?: string[] } | { undo: true }}
 * @throws {Error} when the line cannot be resolved against the board
 */
export function resolvePlaybackMove(state, parsed) {
  if (!parsed) throw new Error('Unrecognized log line');
  if (parsed.type === 'draw') return { type: 'draw' };
  if (parsed.type === 'recycle') return { type: 'recycle' };
  if (parsed.type === 'undo') return { undo: true };
  const pile = pileOf(state, parsed.from);
  const n = parsed.labels.length;
  if (!pile || pile.length < n) {
    throw new Error(`Source pile too short for ${parsed.labels.join(',')}`);
  }
  // Labels are bottom->top (head first); the run must be the pile top.
  const top = pile.slice(pile.length - n);
  for (let i = 0; i < n; i++) {
    if (!labelMatches(top[i], parsed.labels[i])) {
      throw new Error(`Log diverged from board at ${parsed.labels.join(',')}`);
    }
  }
  return {
    type: 'moveCards',
    from: parsed.from,
    to: parsed.to,
    cardIds: top.map((c) => c.id).reverse(),
  };
}

/**
 * Build the full linear board sequence: states[0] is the dealt board,
 * states[i+1] the board after line i. 'U' pushes the inverted board.
 * @param {import('./GameState.js').GameState} initial  freshly dealt board
 * @param {string[]} lines  raw log lines
 * @returns {import('./GameState.js').GameState[]}
 * @throws {Error} on any unparseable or unresolvable line
 */
export function buildPlaybackStates(initial, lines) {
  const states = [initial];
  const list = Array.isArray(lines) ? lines : [];
  for (const line of list) {
    const parsed = parseLogLine(line);
    if (!parsed) throw new Error(`Unrecognized log line: ${JSON.stringify(line)}`);
    const cur = states[states.length - 1];
    if (parsed.type === 'undo') {
      if (states.length < 2) throw new Error('Undo with no previous step');
      states.push(coreUndo(cur));
      continue;
    }
    states.push(applyMove(cur, resolvePlaybackMove(cur, parsed)));
  }
  return states;
}

function locateAll(state) {
  const map = new Map();
  const put = (loc, pile) => {
    for (const c of pile) map.set(c.id, loc);
  };
  put('stock', state.stock);
  put('waste', state.waste);
  state.foundations.forEach((p, i) => put(`foundation:${i}`, p));
  state.tableau.forEach((p, i) => put(`tableau:${i}`, p));
  return map;
}

/**
 * Cards that changed piles between two boards (for animating a step).
 * @param {import('./GameState.js').GameState} a
 * @param {import('./GameState.js').GameState} b
 * @returns {{ animIds: string[], destLocs: string[] }}
 */
export function diffPlaybackStates(a, b) {
  const before = locateAll(a);
  const after = locateAll(b);
  const animIds = [];
  const destSet = new Set();
  for (const [id, locB] of after) {
    if (before.get(id) !== locB) {
      animIds.push(id);
      destSet.add(locB);
    }
  }
  return { animIds, destLocs: [...destSet] };
}
