// core/coinRewards.js
// Framework-agnostic win coin reward computation (no React/DOM imports).
// Mirrors the server-side derivation in migration_032 (coin_reward_rules +
// coin_reward_settings) for the OPTIMISTIC display only: toast text, coin
// flight count, and the pre-sync balance bump. The server recomputes from
// its own tables on flush and stays authoritative — the client reconciles
// any difference (see sync/operations.js), so a stale cache or a tampered
// client can never mint coins, only briefly mis-display them.

/**
 * @typedef {Object} RewardRule
 * @property {number} base_reward
 * @property {number|null} [fast_ms_threshold]
 * @property {number} [fast_bonus]
 * @property {number|null} [few_moves_threshold]
 * @property {number} [few_moves_bonus]
 */

/**
 * @typedef {Object} RewardConfig
 * @property {Record<string, RewardRule>} [rules]  keyed by game kind
 * @property {number} [fallbackBase]  base for unknown kinds (server default 5)
 */

/**
 * Compute the prospective coin award for a win. Bonuses stack additively.
 * Unknown game kinds (or missing config) fall back to the base with no
 * bonuses — matching the server's conservative path.
 *
 * @param {object} win
 * @param {string|null} [win.gameKind]
 * @param {number} win.durationMs
 * @param {number} win.moves
 * @param {RewardConfig|null} [config]
 * @returns {{base:number, timeBonus:number, movesBonus:number, total:number}}
 */
export function computeReward({ gameKind, durationMs, moves }, config) {
  const fallbackBase =
    config && Number.isFinite(config.fallbackBase) ? config.fallbackBase : 5;
  const rule = (config && config.rules && config.rules[gameKind]) || null;
  if (!rule) {
    return { base: fallbackBase, timeBonus: 0, movesBonus: 0, total: fallbackBase };
  }
  const base = Math.max(0, rule.base_reward ?? 0);
  const timeBonus =
    rule.fast_ms_threshold != null &&
    Number.isFinite(durationMs) &&
    durationMs >= 0 &&
    durationMs < rule.fast_ms_threshold
      ? Math.max(0, rule.fast_bonus ?? 0)
      : 0;
  const movesBonus =
    rule.few_moves_threshold != null &&
    Number.isFinite(moves) &&
    moves >= 0 &&
    moves < rule.few_moves_threshold
      ? Math.max(0, rule.few_moves_bonus ?? 0)
      : 0;
  return { base, timeBonus, movesBonus, total: base + timeBonus + movesBonus };
}
