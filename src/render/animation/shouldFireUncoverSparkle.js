// render/animation/shouldFireUncoverSparkle.js
// Pure decision helper for whether the Uncover Sparkle should fire on a given
// state-mutating action. Extracted as a pure function (no React, no GSAP, no
// DOM) so the trigger policy is exhaustively unit-testable under node --test
// without any module mocking.
//
// Trigger policy (the source of truth):
//   The sparkle is a celebratory effect for revealing a face-down tableau
//   card. It must fire ONLY when a `moveCards` action actually exposed such
//   a card (i.e. the move record's `flippedId` is set, which moveEngine.js
//   only sets when the source was a tableau column whose new top card was
//   face-down before the move).
//
//   It must NOT fire for:
//     - `deal`        (initial / new game / daily / event deal)
//     - `draw`        (drawing from stock — the drawn card comes from the
//                      stock pile, not a tableau column, and was already
//                      face-down there)
//     - `recycle`     (recycling stock — moves stock↔waste, never a tableau)
//     - `auto`        (auto-complete chain — the win cascade + confetti
//                      provide the celebration; per-card sparkles on every
//                      step would be visual noise)
//     - `undo`        (undo covers a previously-exposed card, it does not
//                      reveal a new one — but the NEXT moveCards that
//                      re-exposes the same card will fire the sparkle
//                      through the normal `move` path, so re-trigger after
//                      undo is preserved by design)
//
//   The trigger is dispatched by the store at the moment the move is
//   applied, NOT by a DOM-diffing hook reading `style.transform` after the
//   fact. This removes the GSAP-async race that caused sparkles to leak
//   onto deal/draw/recycle previously.

/**
 * @param {object} args
 * @param {object|null} args.moveRecord  the most recent entry in moveHistory,
 *                                        or null for actions with no record
 *                                        (e.g. `deal`)
 * @param {string} args.actionType       one of 'deal' | 'draw' | 'recycle'
 *                                                  | 'move' | 'auto' | 'undo'
 * @param {(cardId: string) => void} args.trigger  dispatcher (the store passes
 *                                        the singleton `triggerUncoverSparkle`;
 *                                        tests pass a mock)
 * @returns {void}
 */
export function shouldFireUncoverSparkle({ moveRecord, actionType, trigger }) {
  if (typeof trigger !== 'function') return;
  if (!moveRecord) return;
  // Defensive actionType guard. The store's contract is that it only calls
  // this helper with actionType === 'move' (or 'auto' for the auto-complete
  // step), and deal/draw/recycle have no move record so the !moveRecord
  // check above already short-circuits them. The explicit blocklist below
  // protects against a future caller that mistakenly passes a stale record
  // with one of these actionTypes.
  if (actionType === 'deal') return;
  if (actionType === 'draw') return;
  if (actionType === 'recycle') return;
  if (actionType === 'auto') return;
  if (actionType === 'undo') return;
  // Only a moveCards move can expose a face-down tableau card.
  if (moveRecord.type !== 'moveCards') return;
  // flippedId is set ONLY when the move's source tableau column's new top
  // card was face-down (moveEngine.js:83-91). If it's null, no card was
  // exposed, so there is nothing to sparkle.
  if (!moveRecord.flippedId) return;
  trigger(moveRecord.flippedId);
}
