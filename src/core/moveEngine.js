// core/moveEngine.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.
//
// applyMove is a PURE function: it takes a state and a move descriptor and returns
// a NEW state. It never mutates the input in place. This is critical because
// undo and the leaderboard's move-sequence validation both rely on snapshots
// being trustworthy.
//
// Each applied move is recorded into state.moveHistory as a canonical record that
// also carries its `inverse` so undo can reconstruct exactly.

/**
 * Parse a pile locator ("stock" | "waste" | "foundation:i" | "tableau:i").
 * @param {string} loc
 * @returns {{ kind: 'stock'|'waste'|'foundation'|'tableau', index?: number }}
 */
export function parseLocator(loc) {
  if (loc === 'stock' || loc === 'waste') {
    return { kind: loc };
  }
  const [kind, idxStr] = loc.split(':');
  if ((kind !== 'foundation' && kind !== 'tableau') || idxStr === undefined) {
    throw new Error(`Invalid pile locator: ${loc}`);
  }
  return { kind, index: Number(idxStr) };
}

function getPile(state, loc) {
  const { kind, index } = parseLocator(loc);
  if (kind === 'stock') return state.stock;
  if (kind === 'waste') return state.waste;
  if (kind === 'foundation') return state.foundations[index];
  return state.tableau[index];
}

/**
 * Return a new state with the given pile replaced. Clones only the affected
 * array structures (cards themselves are treated as immutable except flips,
 * which produce new card objects).
 * @param {import('./GameState.js').GameState} state
 * @param {string} loc
 * @param {any[]} newPile
 */
function withPile(state, loc, newPile) {
  const { kind, index } = parseLocator(loc);
  if (kind === 'stock') return { ...state, stock: newPile };
  if (kind === 'waste') return { ...state, waste: newPile };
  if (kind === 'foundation') {
    const foundations = state.foundations.slice();
    foundations[index] = newPile;
    return { ...state, foundations };
  }
  const tableau = state.tableau.slice();
  tableau[index] = newPile;
  return { ...state, tableau };
}

/**
 * Move a run of cards (identified by ids, which must be the top of `from`) to `to`.
 * Automatically flips the newly-exposed tableau card face-up if needed.
 *
 * @param {import('./GameState.js').GameState} state
 * @param {{ from: string, to: string, cardIds: string[] }} move
 * @returns {import('./GameState.js').GameState}
 */
function applyMoveCards(state, move) {
  const { from, to, cardIds } = move;
  const src = getPile(state, from).slice();
  const dst = getPile(state, to).slice();

  if (cardIds.length === 0) throw new Error('moveCards requires at least one card');
  // Verify the moved ids are exactly the top `cardIds.length` cards of the source.
  const srcTop = src.slice(src.length - cardIds.length).map((c) => c.id);
  const expected = cardIds.slice().reverse();
  if (srcTop.join(',') !== expected.join(',')) {
    throw new Error(`cardIds are not a contiguous top run of ${from}`);
  }

  const moved = src.splice(src.length - cardIds.length, cardIds.length);
  const newSrc = src;

  // Auto-flip: if the source is a tableau column and its new top card is face-down, flip it.
  let flippedId = null;
  const parsedFrom = parseLocator(from);
  if (parsedFrom.kind === 'tableau' && newSrc.length > 0) {
    const top = newSrc[newSrc.length - 1];
    if (!top.faceUp) {
      flippedId = top.id;
      newSrc[newSrc.length - 1] = { ...top, faceUp: true };
    }
  }

  const newDst = dst.concat(moved);

  let next = withPile(state, from, newSrc);
  next = withPile(next, to, newDst);

  const applied = {
    type: 'moveCards',
    from,
    to,
    cardIds: cardIds.slice(),
    flippedId,
  };
  next = { ...next, moveHistory: [...next.moveHistory, applied] };
  return next;
}

/**
 * Draw the top card of the stock into the waste face-up.
 * If stock is empty, this is a no-op (recycling is a separate move).
 *
 * @param {import('./GameState.js').GameState} state
 * @returns {import('./GameState.js').GameState}
 */
function applyDraw(state) {
  if (state.stock.length === 0) return state;
  const stock = state.stock.slice();
  const drawn = stock.pop();
  const waste = state.waste.slice();
  waste.push({ ...drawn, faceUp: true });
  const next = { ...state, stock, waste };
  const applied = { type: 'draw' };
  return { ...next, moveHistory: [...next.moveHistory, applied] };
}

/**
 * Recycle the waste back into the stock (all cards face-down, order preserved or reversed
 * per house rules — here we reverse so the former top of waste becomes the new top of stock).
 *
 * @param {import('./GameState.js').GameState} state
 * @returns {import('./GameState.js').GameState}
 */
function applyRecycle(state) {
  if (state.waste.length === 0) return state;
  const stock = state.waste
    .slice()
    .reverse()
    .map((c) => ({ ...c, faceUp: false }));
  const next = { ...state, stock, waste: [] };
  const applied = { type: 'recycle' };
  return { ...next, moveHistory: [...next.moveHistory, applied] };
}

/**
 * Apply any recognized move to a state and return a new state.
 *
 * @param {import('./GameState.js').GameState} state
 * @param {{ type: string, from?: string, to?: string, cardIds?: string[] }} move
 * @returns {import('./GameState.js').GameState}
 */
export function applyMove(state, move) {
  switch (move.type) {
    case 'moveCards':
      return applyMoveCards(state, move);
    case 'draw':
      return applyDraw(state);
    case 'recycle':
      return applyRecycle(state);
    default:
      throw new Error(`Unknown move type: ${move.type}`);
  }
}

/**
 * Compute the inverse of a recorded move so it can be re-applied to undo.
 * @param {object} record  a move record from moveHistory
 * @returns {object} a move descriptor consumable by applyMove
 */
function invert(record) {
  switch (record.type) {
    case 'moveCards': {
      const inverse = {
        type: 'moveCards',
        from: record.to,
        to: record.from,
        cardIds: record.cardIds.slice(),
      };
      // The flipped card (if any) gets flipped back down when returned to its tableau column.
      if (record.flippedId) {
        inverse.flippedDownId = record.flippedId;
      }
      return inverse;
    }
    case 'draw':
      return { type: 'recycle-undo' }; // handled specially below
    case 'recycle':
      return { type: 'draw-undo' }; // handled specially below
    default:
      throw new Error(`Cannot invert move type: ${record.type}`);
  }
}

// Specialized inverse application for draw/recycle (they reshuffle card faces).
function applyInverse(state, record) {
  const inv = invert(record);
  if (record.type === 'draw') {
    // undo a draw: move waste top back to stock face-down
    const waste = state.waste.slice();
    const card = waste.pop();
    const stock = state.stock.slice();
    stock.push({ ...card, faceUp: false });
    return { ...state, stock, waste };
  }
  if (record.type === 'recycle') {
    // undo a recycle: move stock back to waste face-up, reversed
    const waste = state.stock
      .slice()
      .reverse()
      .map((c) => ({ ...c, faceUp: true }));
    return { ...state, stock: [], waste };
  }
  if (inv.type === 'moveCards') {
    let next = applyMoveCards(state, inv);
    if (inv.flippedDownId) {
      // flip that card back down
      const loc = inv.to; // returned to `from` of original = inv.to
      const pile = getPile(next, loc).slice();
      const idx = pile.findIndex((c) => c.id === inv.flippedDownId);
      if (idx !== -1) {
        pile[idx] = { ...pile[idx], faceUp: false };
        next = withPile(next, loc, pile);
      }
    }
    return next;
  }
  throw new Error(`Unhandled inverse for ${record.type}`);
}

/**
 * Undo the most recent move. Returns a new state with the move removed from history.
 * @param {import('./GameState.js').GameState} state
 * @returns {import('./GameState.js').GameState}
 */
export function undo(state) {
  if (state.moveHistory.length === 0) return state;
  const history = state.moveHistory.slice();
  const last = history.pop();
  const undone = applyInverse(state, last);
  return { ...undone, moveHistory: history };
}
