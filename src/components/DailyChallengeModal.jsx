// components/DailyChallengeModal.jsx
// Calendar picker for the Daily Challenge. Shows a month grid (days 1..31), lets
// the player navigate by month/year, marks already-completed days and "today",
// disables future / out-of-window days, and starts the selected day's deal via
// the "Play" button. A side panel shows the selected day's best result.
//
// "Today" is sourced from a public time API (utils/serverTime) and never from
// the device clock. The deal seed for each day is pre-generated and bundled
// (core/dailyChallenge.seedForDate).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Crosshair, ChevronLeft, ChevronRight } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useGameStore } from '../hooks/useGameStore.js';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { pullRemoteProfile } from '../sync/pullProfile.js';
import {
  listSupportedYears,
  isSupportedYM,
  withinSupported,
  isAfter,
  addMonths,
  daysInMonth,
  toDateStr,
  dateToUTC,
  seedForDate,
} from '../core/dailyChallenge.js';
import { utcToYMD, getFallbackUTC, getCachedServerNow, refreshServerNowWithRetry } from '../utils/serverTime.js';
import { loadAllDailyResults } from '../db/dailyResults.js';
import { loadLastDailySelection, loadLastDailySelectionSync, saveLastDailySelection } from '../db/dailySelection.js';
import { formatTime } from '../utils/formatTime.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Shared button chrome (mirrors the other modals' theme variables).
const btn = {
  padding: '9px 14px',
  borderRadius: 6,
  border: '1px solid var(--ui-modal-btn-border)',
  background: 'var(--ui-modal-btn-bg)',
  color: 'var(--ui-modal-fg)',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
};

const panel = {
  position: 'relative',
  background: 'var(--ui-modal-panel-bg)',
  color: 'var(--ui-modal-panel-fg)',
  border: 'var(--ui-modal-panel-border)',
  borderRadius: 'var(--ui-modal-panel-radius)',
  boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
  padding: '20px 22px',
  width: 'min(94vw, 760px)',
  maxWidth: '100%',
  outline: 'none',
};

const selectStyle = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--ui-control-border)',
  background: 'var(--ui-control-bg)',
  color: 'var(--ui-control-fg)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 6,
};

const fallbackDate = (() => {
  const f = utcToYMD(getFallbackUTC());
  return toDateStr(f.y, f.m, f.d);
})();

export default function DailyChallengeModal() {
  const open = useUiStore((s) => s.dailyChallengeDialogOpen);
  const dealDaily = useGameStore((s) => s.dealDaily);

  const setOpen = useUiStore((s) => s.setDailyChallengeDialogOpen);
  const setNewGameOpen = useUiStore((s) => s.setNewGameDialogOpen);

  const panelRef = useRef(null);
  const userPicked = useRef(false);
  // Mirror of `selected` / `today` (state) for reads inside async callbacks
  // without re-running effects; and the open-time {today, selected, usedPreferred}
  // triple so a background refresh can tell whether selection was still
  // "today-bound" or advanced by a win, and therefore must not be overridden.
  const selectedRef = useRef(null);
  const todayRef = useRef(fallbackDate);
  const initialRef = useRef({ today: null, selected: null, usedPreferred: false });

  const applySelected = (v) => { selectedRef.current = v; setSelected(v); };
  const applyToday = (v) => { todayRef.current = v; setToday(v); };

  const [today, setToday] = useState(fallbackDate);
  const [viewY, setViewY] = useState(() => utcToYMD(getFallbackUTC()).y);
  const [viewM, setViewM] = useState(() => utcToYMD(getFallbackUTC()).m);
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState({});

  // Dismiss returns to the New Game picker only when opened from it (not from
  // the Win modal, which already closed before opening this one). A day the
  // player manually selected is persisted so the calendar re-opens there next
  // time, even when the modal is dismissed without playing. This includes the
  // current day (today) — it should be remembered exactly like any other
  // available day.
  const onDismiss = () => {
    if (selected && withinSupported(selected) && !isAfter(selected, today)) {
      saveLastDailySelection(selected);
    }
    setOpen(false);
    if (useUiStore.getState().dailyChallengeOrigin === 'newgame') setNewGameOpen(true);
  };

  const backdrop = useModalBackdrop(onDismiss);
  useModalEscape({ open, onClose: onDismiss, id: 'daily', z: Z.CHILD });

  // Synchronously resolve the initial selection on open — BEFORE any network
  // round-trip — so the calendar is interactive immediately and a quick "Play"
  // cannot land on a stale (e.g. not-yet-advanced) day. Uses the cached server
  // "today" (or the hard fallback) and the cached last-selection, both available
  // synchronously; the network refresh below only refines these afterward.
  // Runs as a layout effect so the correct month/selection is committed to the
  // DOM before the browser paints — eliminating the flash-to-January on reload.
  useLayoutEffect(() => {
    if (!open) return undefined;
    userPicked.current = false;

    const nowMs = getCachedServerNow() != null ? getCachedServerNow() : getFallbackUTC();
    const { y, m, d } = utcToYMD(nowMs);
    const todayStr = toDateStr(y, m, d);
    applyToday(todayStr);
    setResults({}); // clear stale completion marks; refilled by async load below

    // A preferred initial date (e.g. advanced to the next day after a daily win)
    // takes precedence and is consumed immediately. It was already validated as
    // within the supported window at the time it was set, so we trust it.
    const preferred = useUiStore.getState().dailyChallengeInitialDate;
    let initial;
    let usedPreferred = false;
    if (preferred) {
      useUiStore.getState().setDailyChallengeInitialDate(null); // consume now
      if (withinSupported(preferred)) { initial = preferred; usedPreferred = true; }
    }
    if (!initial) {
      const lastSel = loadLastDailySelectionSync();
      initial = (lastSel && lastSel !== todayStr) ? lastSel : todayStr;
    }
    if (!withinSupported(initial)) initial = todayStr;

    const ini = utcToYMD(dateToUTC(initial));
    setViewY(ini.y);
    setViewM(ini.m);
    applySelected(initial);
    initialRef.current = { today: todayStr, selected: initial, usedPreferred };
    // Persist the advanced day (e.g. set after a daily win) so it survives a
    // hard reload — the in-memory store field is lost on refresh, and without
    // this the calendar would fall back to the previously saved (played) day.
    if (usedPreferred && initial !== todayStr) saveLastDailySelection(initial);
    return undefined;
  }, [open]);

  // Background refinement on open: load completed-day results and refresh the
  // authoritative "today" from the server. These do NOT block the selection —
  // they only fill completion marks and, when the player hasn't manually picked
  // and the selection was still bound to the (possibly stale) open-time "today",
  // nudge selection to the corrected today. The Dexie-loaded last-selection is a
  // graceful fallback for environments where the synchronous localStorage seed
  // was unavailable (it is otherwise a no-op since the layout effect already
  // applied it).
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;

    Promise.all([
      loadAllDailyResults(),
      loadLastDailySelection(),
    ]).then(([rows, lastSel]) => {
      if (cancelled) return;
      const map = {};
      rows.forEach((r) => { map[r.date] = r; });
      setResults(map);
      if (
        !userPicked.current &&
        !initialRef.current.usedPreferred &&
        lastSel &&
        withinSupported(lastSel) &&
        lastSel !== todayRef.current
      ) {
        const ini = utcToYMD(dateToUTC(lastSel));
        setViewY(ini.y);
        setViewM(ini.m);
        applySelected(lastSel);
      }
    });

    refreshServerNowWithRetry({ shouldCancel: () => cancelled }).then((ms) => {
      if (cancelled || ms == null) return;
      const { y, m, d } = utcToYMD(ms);
      const todayStr = toDateStr(y, m, d);
      applyToday(todayStr);
      const wasTodayBound =
        !userPicked.current &&
        !initialRef.current.usedPreferred &&
        selectedRef.current === initialRef.current.today &&
        initialRef.current.selected === initialRef.current.today;
      if (wasTodayBound) applySelected(todayStr);
    });

    return () => { cancelled = true; };
  }, [open]);

  // Focus the panel when the dialog opens.
  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => panelRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  // Pull the linked account's latest progress when the calendar opens, so
  // completion marks / bests reflect what another device has done.
  useEffect(() => {
    if (open && !useAuthStore.getState().isAnonymous) {
      pullRemoteProfile().catch((e) => console.error('Daily Challenge profile pull failed', e));
    }
  }, [open]);

  if (!open) return null;

  const onPlay = () => {
    if (!selected) return;
    if (isAfter(selected, today) || !withinSupported(selected)) return;
    const run = () => {
      const ok = dealDaily(selected);
      if (ok) {
        // Remember the picked day so the calendar re-opens there next time
        // (persisted in the DB). This includes today, which is treated like any
        // other available day.
        saveLastDailySelection(selected);
        setOpen(false);
      }
    };
    // If a game is in progress, stash the deal behind the "discard current game?"
    // confirmation (which records a loss on confirm); otherwise deal immediately.
    if (useStatsStore.getState().isInProgress()) {
      useUiStore.getState().setPendingStartDeal(run);
      useUiStore.getState().setConfirmNewGameDialogOpen(true);
    } else {
      run();
    }
  };

  // Jump the grid back to today and select it.
  const onGoToday = () => {
    const ini = utcToYMD(dateToUTC(today));
    setViewY(ini.y);
    setViewM(ini.m);
    applySelected(today);
    userPicked.current = true;
  };

  const prev = addMonths(viewY, viewM, -1);
  const next = addMonths(viewY, viewM, 1);
  const canPrev = isSupportedYM(prev.y, prev.m);
  const canNext = isSupportedYM(next.y, next.m);
  const years = listSupportedYears();
  const monthsInYear = Array.from({ length: 12 }, (_, i) => i + 1);

  const selectedResult = selected ? results[selected] : null;

  // Build the day grid for the actual days of this month (1..daysInMonth).
  const cells = [];
  const dim = daysInMonth(viewY, viewM);
  for (let d = 1; d <= dim; d++) {
    const dateStr = toDateStr(viewY, viewM, d);
    const validDay = true;
    const supported = withinSupported(dateStr);
    const future = isAfter(dateStr, today);
    const enabled = validDay && supported && !future;
    const completed = !!results[dateStr];
    const isToday = dateStr === today;
    const isSel = dateStr === selected;

    const classes = ['dc-cell'];
    if (!enabled) classes.push('dc-cell--disabled');
    if (completed) classes.push('dc-cell--completed');
    if (isToday) classes.push('dc-cell--today');
    if (isSel) classes.push('dc-cell--selected');

    if (enabled) {
      cells.push(
        <button
          key={d}
          type="button"
          className={classes.join(' ')}
          onClick={() => { userPicked.current = true; applySelected(dateStr); }}
          aria-pressed={isSel}
          aria-label={`Day ${d}${completed ? ' (completed)' : ''}${isToday ? ' (today)' : ''}`}
        >
          {d}
        </button>,
      );
    } else {
      cells.push(
        <div key={d} className={classes.join(' ')} aria-hidden="true">
          {d}
        </div>,
      );
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Daily Challenge"
      {...backdrop}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3100,
        padding: 16,
      }}
    >
      <div ref={panelRef} tabIndex={-1} style={panel}>
        <h2 style={{ margin: '0 0 14px', fontSize: 20, fontWeight: 800, textAlign: 'center', paddingRight: 36 }}>
          Daily Challenge
        </h2>
        <ModalCloseButton onClick={onDismiss} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Header: arrows + month/year selectors */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 44px' }}>
            <button
              type="button"
              aria-label="Previous month"
              disabled={!canPrev}
              onClick={() => { if (canPrev) { setViewM(prev.m); setViewY(prev.y); } }}
              style={{
                ...btn,
                position: 'absolute',
                left: 0,
                minWidth: 36,
                opacity: canPrev ? 1 : 0.4,
                cursor: canPrev ? 'pointer' : 'default',
              }}
            >
              <ChevronLeft size={18} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select
                aria-label="Month"
                value={viewM}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  if (isSupportedYM(viewY, m)) setViewM(m);
                }}
                style={selectStyle}
              >
                {monthsInYear.map((m) => (
                  <option key={m} value={m} disabled={!isSupportedYM(viewY, m)}>
                    {MONTH_NAMES[m - 1]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Year"
                value={viewY}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  if (isSupportedYM(y, viewM)) setViewY(y);
                }}
                style={selectStyle}
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              aria-label="Next month"
              disabled={!canNext}
              onClick={() => { if (canNext) { setViewM(next.m); setViewY(next.y); } }}
              style={{
                ...btn,
                position: 'absolute',
                right: 0,
                minWidth: 36,
                opacity: canNext ? 1 : 0.4,
                cursor: canNext ? 'pointer' : 'default',
              }}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Body: calendar grid + side panel */}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <div style={gridStyle}>{cells}</div>
            </div>

            <div style={{ flex: '1 1 220px', minWidth: 200, borderLeft: '1px solid var(--ui-modal-panel-border)', paddingLeft: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Best Result</h3>
              {selected ? (
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                  <div style={{ marginBottom: 8, fontWeight: 600 }}>{selected}</div>
                  <div>Seed: {selectedResult ? selectedResult.seed : seedForDate(selected)}</div>
                  <div>Best Score: {selectedResult ? selectedResult.bestScore : 0}</div>
                  <div>Best Time: {selectedResult ? formatTime(selectedResult.bestTimeMs) : formatTime(0)}</div>
                  <div>Best Moves: {selectedResult ? selectedResult.bestMoves : 0}</div>
                  <div style={{ opacity: 0.7 }}>
                    Completed {selectedResult ? selectedResult.wins : 0} time(s)
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--ui-modal-panel-fg)', opacity: 0.75 }}>Select a day to see its best result.</div>
              )}
            </div>
          </div>

          {/* Footer actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
            <button
              type="button"
              aria-label="Go to today"
              title="Go to today"
              onClick={onGoToday}
              style={{
                ...btn,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 6,
                minWidth: 32,
                cursor: 'pointer',
              }}
            >
              <Crosshair size={18} />
            </button>
            <button
              type="button"
              disabled={!selected || isAfter(selected, today) || !withinSupported(selected)}
              onClick={onPlay}
              style={{
                ...btn,
                background: 'var(--ui-modal-btn-bg-strong)',
                opacity: selected ? 1 : 0.5,
                cursor: selected ? 'pointer' : 'default',
              }}
            >
              Play
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
