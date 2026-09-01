// hooks/useStatsStore.js
// In-memory game session stats: moves, score, and the play timer.
// Not persisted to the DB (per product decision). The timer is timestamp-based
// and PAUSES when the tab loses focus: hidden time is excluded via a running
// `pausedAccumMs` + `pausedAt` pair, so the displayed elapsed (recomputed from
// real wall-clock timestamps) reflects only actively-focused play time.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useStatisticsStore } from './useStatisticsStore.js';
import {
  createAchievementTelemetry as createTelemetry,
  markHintUsed,
  markUndoUsed,
  recordAchievementMove,
  recordRecycle,
} from '../core/achievementTelemetry.js';

// Hard limits that end the game. Reaching either freezes the session so only a
// new game can continue (timer stops, moves stop, interactions lock).
export const MAX_TIME_MS = 60 * 30 * 1000; // 30:00
export const MAX_MOVES = 500;

const createGameId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const createAchievementTelemetry = () => createTelemetry(createGameId());

export const useStatsStore = create(subscribeWithSelector((set, get) => ({
  moves: 0,
  score: 0, // not implemented yet — stays 0
  undos: 0, // number of undo actions performed in the current game
  startTime: null, // epoch ms when the clock started (first valid interaction)
  endTime: null, // epoch ms when the clock stopped (on win or limit)
  isOver: false, // true once a limit is hit — locks all interaction
  overReason: null, // 'time' | 'moves' — which limit ended the game
  // Focus-loss pause bookkeeping: `pausedAt` is the epoch ms at which the tab
  // became hidden while the clock was running (null when focused), and
  // `pausedAccumMs` is the total hidden time already folded in. Elapsed is
  // always `now - startTime` minus this excluded span.
  pausedAt: null,
  pausedAccumMs: 0,
  achievementTelemetry: createAchievementTelemetry(),

  /** Reset all stats for a fresh game. */
  resetStats: () =>
    set({
      moves: 0,
      score: 0,
      undos: 0,
      startTime: null,
      endTime: null,
      isOver: false,
      overReason: null,
      pausedAt: null,
      pausedAccumMs: 0,
      achievementTelemetry: createAchievementTelemetry(),
    }),

  markHintUsed: () => set((s) => ({
    achievementTelemetry: markHintUsed(s.achievementTelemetry),
  })),

  recordRecycle: () => set((s) => ({
    achievementTelemetry: recordRecycle(s.achievementTelemetry),
  })),

  recordMove: ({ from, to, card }) => set((s) => ({
    achievementTelemetry: recordAchievementMove(s.achievementTelemetry, { from, to, card }),
  })),

  recordUndo: () => set((s) => ({
    achievementTelemetry: markUndoUsed(s.achievementTelemetry),
  })),

  /**
   * Pause/resume the clock in step with tab focus. Called on `visibilitychange`
   * (and once on mount). When the tab is hidden while the clock runs we record
   * `pausedAt`; when it becomes visible again we fold the hidden span into
   * `pausedAccumMs` so it is excluded from elapsed time. A frozen/stopped clock
   * is unaffected (it has no live running time to pause).
   * @param {boolean} focused  true when the tab is visible/focused
   */
  setFocused: (focused) => {
    const { startTime, endTime, isOver, pausedAt, pausedAccumMs } = get();
    if (startTime === null || endTime !== null || isOver) {
      // Nothing live to pause. Clear any stale marker defensively.
      if (pausedAt !== null) set({ pausedAt: null });
      return;
    }
    if (!focused) {
      if (pausedAt === null) set({ pausedAt: Date.now() });
    } else if (pausedAt !== null) {
      const accumulated = pausedAccumMs + (Date.now() - pausedAt);
      set({ pausedAt: null, pausedAccumMs: accumulated });
    }
  },

  /**
   * Elapsed actively-focused play time in ms (excludes hidden spans). Clamped to
   * >= 0. `now` defaults to Date.now() but callers may pass a tick timestamp so
   * the value is consistent with a render pass.
   * @param {number} [now]
   * @returns {number}
   */
  getElapsedMs: (now = Date.now()) => {
    const { startTime, endTime, pausedAt, pausedAccumMs } = get();
    if (startTime === null) return 0;
    const end = endTime ?? now;
    const paused = pausedAccumMs + (pausedAt !== null ? now - pausedAt : 0);
    return Math.max(0, end - startTime - paused);
  },

  /**
   * Freeze the session: lock interaction and stop the clock. The 500th move is
   * still applied before this fires (caller increments first), so the counter
   * reads exactly MAX_MOVES. For the time limit we pin endTime so the display
   * reads exactly 30:00 rather than a slightly-over 250ms-tick value.
   * @param {'time'|'moves'} reason
   */
  freeze: (reason) => {
    const { isOver, startTime, endTime } = get();
    // The clock already stopped (a win pinned endTime) — never let a hard limit
    // overwrite the win state and flip isOver on.
    if (isOver || endTime !== null) return;
    // Fold any in-progress focus pause before pinning the end time so the final
    // elapsed reflects only actively-focused play.
    if (get().pausedAt !== null) get().setFocused(true);
    set({ isOver: true, overReason: reason });
    if (startTime !== null && endTime === null) {
      set({ endTime: reason === 'time' ? startTime + MAX_TIME_MS : Date.now() });
    }
    // Game Over is a loss: break the winning streak immediately (mirrors
    // recordWin at win time and recordGamePlayed at timer-start time). This is
    // the "elsewhere" finalizeGame expects for a limit-ended game. The guard
    // above ensures it fires exactly once per game-over, and a won game bails
    // here (endTime already pinned), so wins never double-count a loss.
    if (startTime !== null) {
      useStatisticsStore.getState().recordLoss();
    }
  },

  /**
   * Called on each timer tick to freeze once elapsed crosses the time limit.
   * Uses paused-adjusted elapsed so hidden time never counts toward the limit.
   */
  checkTimeLimit: () => {
    const { isOver, startTime, endTime } = get();
    // Don't re-evaluate the time limit once the clock has stopped — a win pins
    // endTime without setting isOver, so isOver alone is not enough to bail out.
    if (isOver || startTime === null || endTime !== null) return;
    if (get().getElapsedMs() >= MAX_TIME_MS) get().freeze('time');
  },

  /**
   * Start the timer on the first successful player action, if it isn't already
   * running. `state` is the board after the action that triggered this call; the
   * gate is intentionally absent because this is only ever invoked following a
   * validated move/draw/recycle, so a real action has already occurred.
   * @param {import('../core/GameState.js').GameState} state
   */
  startTimerIfValid: (state) => {
    if (get().startTime !== null) return;
    // startTimerIfValid is only ever called after a successful, validated
    // draw/recycle/move (the action has already mutated the board), so a real
    // action has occurred by the time we reach here. Start counting immediately
    // rather than gating on hasDeadEndMove, which ignores stock draws and
    // non-progress shuffles and would otherwise leave the clock at 00:00 on the
    // ~9% of deals (and any restored/draw-only position) whose only first move is
    // a stock draw.
    set({ startTime: Date.now(), pausedAccumMs: 0, pausedAt: null });

    // A new game's clock has just begun — count it as a game played. This fires
    // exactly once per game because we early-returned above when already running.
    useStatisticsStore.getState().recordGamePlayed();
  },

  /** Add one (or more) moves to the counter. Freezes at the move limit. */
  addMoves: (n = 1) => {
    const { isOver, moves } = get();
    if (isOver) return;
    const next = moves + n;
    set({ moves: next });
    if (next >= MAX_MOVES) get().freeze('moves');
  },

  /** Record one (or more) undo actions performed in the current game. */
  addUndos: (n = 1) => {
    if (get().isOver) return;
    set({ undos: get().undos + n });
  },

  /** Freeze the clock (e.g. when the game is won). */
  stopTimer: () => {
    const { startTime, endTime } = get();
    if (startTime !== null && endTime === null) {
      // Fold any in-progress focus pause before pinning the end time so the
      // final elapsed reflects only actively-focused play.
      if (get().pausedAt !== null) get().setFocused(true);
      set({ endTime: Date.now() });
    }
  },

  /**
   * True when a real game is in progress: the timer has started, has not ended,
   * and the game is not over (no win, no hard limit). Used to decide whether a
   * new/replacement deal must be confirmed before discarding progress. Mirrors
   * the `timerRunning` check in Board.jsx's `n` shortcut.
   */
  isInProgress: () => {
    const s = get();
    return s.startTime != null && s.endTime == null && !s.isOver;
  },
})));
