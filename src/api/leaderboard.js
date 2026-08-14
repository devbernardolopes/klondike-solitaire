// api/leaderboard.js
// STUB: mock/local leaderboard client. Structured so a real backend (Supabase /
// Vercel Postgres) can be dropped in later behind the same function signatures.
//
// TODO(next pass): replace localStorage implementation with a real HTTP/Supabase
// client. Keep submitScore()/fetchTopScores() signatures stable.

/**
 * @typedef {Object} ScoreEntry
 * @property {string} player
 * @property {number} durationMs
 * @property {number} moves
 * @property {number} submittedAt
 */

const LS_KEY = 'klondike.leaderboard.local';

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLocal(entries) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries));
  } catch {
    // ignore quota / unavailable storage
  }
}

/**
 * Submit a winning score. Resolves to the stored entry (with id).
 * @param {{ player?: string, durationMs: number, moves: number }} score
 * @returns {Promise<ScoreEntry & { id: number }>}
 */
export async function submitScore(score) {
  const entry = {
    id: Date.now(),
    player: score.player || 'anonymous',
    durationMs: score.durationMs,
    moves: score.moves,
    submittedAt: Date.now(),
  };
  const all = readLocal();
  all.push(entry);
  writeLocal(all);
  // TODO(next pass): POST to backend; return server-assigned id.
  return entry;
}

/**
 * Fetch top scores, sorted by duration ascending.
 * @param {number} [limit=10]
 * @returns {Promise<Array<ScoreEntry & { id: number }>>}
 */
export async function fetchTopScores(limit = 10) {
  const all = readLocal().sort((a, b) => a.durationMs - b.durationMs);
  // TODO(next pass): GET from backend, apply server-side sorting/pagination.
  return all.slice(0, limit);
}
