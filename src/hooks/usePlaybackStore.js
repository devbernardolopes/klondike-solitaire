// hooks/usePlaybackStore.js
// Step-through player for recorded deals (game_results.move_log).
// The driver NEVER touches game actions, stats, coins, or persistence: it
// rebuilds the deal purely (deal({seed}) + precomputed states[]) and writes
// boards via useGameStore.showPlaybackState (direct set + Flip tween).
// Isolation is by construction; the `playbackActive` UI flag additionally
// gates the win effect, solver auto-fire, session saves, and all inputs.

import { create } from 'zustand';
import { deal } from '../core/dealer.js';
import { buildPlaybackStates, diffPlaybackStates } from '../core/playback.js';
import { useGameStore } from './useGameStore.js';
import { useUiStore } from './useUiStore.js';
import i18n from '../i18n/index.js';

/** Playback speeds offered by the speed cycler. */
export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 2];

/** Gap per step at 1.00x (divided by speed). */
export const PLAYBACK_BASE_DELAY_MS = 800;

let playTimer = null;
// Bumped on pause/stop/start so an in-flight tick never applies after it.
let playRunId = 0;

function clearPlayTimer() {
  if (playTimer !== null) {
    clearTimeout(playTimer);
    playTimer = null;
  }
}

function clampCursor(cursor, total) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(total - 1, cursor));
}

export const usePlaybackStore = create((set, get) => {
  /** Apply cursor (animated single step or instant jump). */
  function applyCursor(cursor, animate) {
    const { states, cursor: cur } = get();
    if (states.length === 0) return;
    const next = clampCursor(cursor, states.length);
    if (next === cur) {
      if (next >= states.length - 1) set({ playing: false });
      return;
    }
    const show = useGameStore.getState().showPlaybackState;
    if (animate) {
      const { animIds, destLocs } = diffPlaybackStates(states[cur], states[next]);
      show(states[next], animIds, destLocs);
    } else {
      show(states[next], [], []);
    }
    set({ cursor: next });
    if (next >= states.length - 1) {
      // Reached the end: stop the loop, stay on the final board so Play
      // can restart from the top on the next press.
      clearPlayTimer();
      playRunId += 1;
      set({ playing: false });
      try {
        useUiStore.getState().setAnnounce(i18n.t('playback.ended'));
      } catch {}
    }
  }

  /** One Play-loop tick: advance a step, then schedule the next. */
  function tick(run) {
    playTimer = null;
    if (run !== playRunId) return;
    if (!useUiStore.getState().playbackActive) {
      set({ playing: false });
      return;
    }
    const { states, cursor } = get();
    if (cursor >= states.length - 1) {
      set({ playing: false });
      return;
    }
    applyCursor(cursor + 1, true);
    if (get().playing) {
      playTimer = setTimeout(() => tick(run), PLAYBACK_BASE_DELAY_MS / get().speed);
    }
  }

  return {
    // Precomputed boards: states[0] is the dealt board, cursor indexes it.
    states: [],
    cursor: 0,
    playing: false,
    speed: 1,
    // Human label for the bar (deal title); the driver never reads it.
    title: null,

    /** Number of steps (states - 1). */
    totalSteps: () => Math.max(0, get().states.length - 1),

    /**
     * Start replaying a recorded deal. Builds every board purely BEFORE
     * touching the live board, so an unresolvable log aborts with the
     * current game untouched.
     * @param {{ seed: number, logText: string, title?: string|null }} args
     * @throws {Error} when the log cannot be replayed
     */
    start: ({ seed, logText, title = null }) => {
      const lines = String(logText ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (seed == null || lines.length === 0) {
        throw new Error('Playback needs a seed and a non-empty recording');
      }
      const states = buildPlaybackStates(deal({ seed }), lines);
      clearPlayTimer();
      playRunId += 1;
      useGameStore.getState().showPlaybackState(states[0], [], []);
      set({ states, cursor: 0, playing: false, speed: 1, title });
      useUiStore.getState().setPlaybackActive(true);
      try {
        useUiStore.getState().setAnnounce(i18n.t('playback.started'));
      } catch {}
    },

    /** Leave playback mode. The board stays as-is until the next deal. */
    stop: () => {
      clearPlayTimer();
      playRunId += 1;
      set({ playing: false, states: [], cursor: 0, title: null });
      useUiStore.getState().setPlaybackActive(false);
    },

    /** Begin auto-advancing (restarts from the top when at the end). */
    play: () => {
      const { states, cursor } = get();
      if (states.length === 0 || get().playing) return;
      clearPlayTimer();
      playRunId += 1;
      const run = playRunId;
      if (cursor >= states.length - 1) {
        applyCursor(0, false);
      }
      set({ playing: true });
      try {
        useUiStore.getState().setAnnounce(i18n.t('playback.playing'));
      } catch {}
      playTimer = setTimeout(() => tick(run), PLAYBACK_BASE_DELAY_MS / get().speed);
    },

    /** Pause auto-advance, staying on the current board. */
    pause: () => {
      if (!get().playing) return;
      clearPlayTimer();
      playRunId += 1;
      set({ playing: false });
      try {
        useUiStore.getState().setAnnounce(i18n.t('playback.paused'));
      } catch {}
    },

    /** Animated ±1 step; pauses an in-progress Play first. */
    stepBy: (delta) => {
      if (get().states.length === 0) return;
      get().pause();
      applyCursor(get().cursor + delta, true);
    },

    /** Instant jump (start/end buttons); pauses an in-progress Play first. */
    stepTo: (cursor) => {
      if (get().states.length === 0) return;
      get().pause();
      applyCursor(cursor, false);
    },

    /** Cycle 0.75x → 1x → 1.25x → 2x → 0.75x… (applies to a running Play). */
    cycleSpeed: () => {
      const idx = PLAYBACK_SPEEDS.indexOf(get().speed);
      set({ speed: PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length] });
    },
  };
});
