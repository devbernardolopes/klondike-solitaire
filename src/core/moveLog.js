// core/moveLog.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.
//
// Compact human-readable recording of every board-configuration step, from
// deal to game end. Each line is one step; lines join with '\n' into the
// `move_log` TEXT stored alongside `game_results` for future playback.
//
// Notation (labels use rank+suit, e.g. Ah,10s,Jd,Qc; piles are 1-indexed):
//   D                draw stock -> waste
//   R                recycle waste -> stock
//   U                undo (pops the previous step; recorded as a marker)
//   Ah W->F1         single card move
//   7h,6s,5h T3->T6  run move, cards listed bottom->top (head first)
//
// Notes:
// - Card labels are unique per deck (rank+suit), so a line re-resolves
//   deterministically against the board state at replay time.
// - `cardIds` in moveEngine are ordered top->bottom; display order here is
//   bottom->top (the run head first, i.e. the card that lands on `to`).
// - Formatting NEVER throws: recording must never break gameplay. Unknown
//   moves return null (caller skips) and unresolvable cards render as '?'.

const SUIT_LETTER = {
  hearts: 'h',
  diamonds: 'd',
  clubs: 'c',
  spades: 's',
};

function rankLabel(rank) {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return String(rank);
}

/**
 * Render a card as rank+suit regardless of faceUp (moved cards are face-up;
 * this avoids the snapshot '00' masking which would lose identity).
 * @param {{ suit: string, rank: number }} card
 * @returns {string}
 */
export function moveCardLabel(card) {
  if (!card || typeof card.rank !== 'number') return '?';
  return `${rankLabel(card.rank)}${SUIT_LETTER[card.suit] ?? '?'}`;
}

/**
 * Short human locator: S / W / F1-F4 / T1-T7 (1-indexed).
 * @param {string} loc  canonical "<kind>" / "<kind>:<index>" locator
 * @returns {string|null}
 */
export function shortLocator(loc) {
  if (loc === 'stock') return 'S';
  if (loc === 'waste') return 'W';
  if (typeof loc !== 'string') return null;
  const [kind, idxStr] = loc.split(':');
  const idx = Number(idxStr);
  if (!Number.isInteger(idx) || idx < 0) return null;
  if (kind === 'foundation') return `F${idx + 1}`;
  if (kind === 'tableau') return `T${idx + 1}`;
  return null;
}

/** Undo marker line. */
export function formatUndo() {
  return 'U';
}

/**
 * Format one pre-move state + move descriptor as a single log line.
 * `state` must be the BEFORE state so cardIds resolve to labels.
 * @param {import('./GameState.js').GameState} state
 * @param {{ type: string, from?: string, to?: string, cardIds?: string[] }} move
 * @returns {string|null}  log line, or null when unformattable (caller skips)
 */
export function formatMove(state, move) {
  if (!move || typeof move.type !== 'string') return null;
  if (move.type === 'draw') return 'D';
  if (move.type === 'recycle') return 'R';
  if (move.type !== 'moveCards') return null;
  const from = shortLocator(move.from);
  const to = shortLocator(move.to);
  if (!from || !to || !Array.isArray(move.cardIds) || move.cardIds.length === 0) return null;
  let byId = null;
  try {
    byId = new Map();
    const piles = [
      ...(state?.stock ?? []),
      ...(state?.waste ?? []),
      ...((state?.foundations ?? []).flat()),
      ...((state?.tableau ?? []).flat()),
    ];
    for (const c of piles) {
      if (c && c.id != null && !byId.has(c.id)) byId.set(c.id, c);
    }
  } catch {
    return null;
  }
  // cardIds are top->bottom; display bottom->top (run head first).
  const labels = move.cardIds
    .slice()
    .reverse()
    .map((id) => moveCardLabel(byId.get(id)));
  return `${labels.join(',')} ${from}->${to}`;
}

/**
 * Serialize log lines for storage. Empty log yields null (no TEXT stored).
 * @param {string[]} lines
 * @returns {string|null}
 */
export function serializeMoveLog(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  return lines.join('\n');
}
