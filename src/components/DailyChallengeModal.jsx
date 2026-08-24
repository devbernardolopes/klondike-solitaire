// components/DailyChallengeModal.jsx
// Calendar picker for the Daily Challenge. Shows a month grid (days 1..31), lets
// the player navigate by month/year, marks already-completed days and "today",
// disables future / out-of-window days, and starts the selected day's deal via
// the "Play" button. A side panel shows the selected day's best result.
//
// "Today" is sourced from a public time API (utils/serverTime) and never from
// the device clock. The deal seed for each day is pre-generated and bundled
// (core/dailyChallenge.seedForDate).

import { useEffect, useRef, useState } from 'react';
import { Crosshair } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useGameStore } from '../hooks/useGameStore.js';
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
import { fetchServerNow, utcToYMD, getFallbackUTC } from '../utils/serverTime.js';
import { loadAllDailyResults } from '../db/dailyResults.js';
import { loadLastDailySelection, saveLastDailySelection } from '../db/dailySelection.js';
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
  background: 'var(--card-face-bg)',
  color: 'var(--card-text-black)',
  border: 'var(--card-border)',
  borderRadius: 'var(--card-radius)',
  boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
  padding: '20px 22px',
  width: 'min(94vw, 760px)',
  maxWidth: '100%',
  outline: 'none',
};

const selectStyle = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--card-border)',
  background: 'var(--card-face-bg)',
  color: 'var(--card-text-black)',
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

  const [today, setToday] = useState(fallbackDate);
  const [viewY, setViewY] = useState(() => utcToYMD(getFallbackUTC()).y);
  const [viewM, setViewM] = useState(() => utcToYMD(getFallbackUTC()).m);
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState({});

  // Dismiss returns to the New Game picker only when opened from it (not from
  // the Win modal, which already closed before opening this one). A day the
  // player manually selected (and that isn't today) is persisted so the calendar
  // re-opens there next time, even when the modal is dismissed without playing.
  const onDismiss = () => {
    if (selected && selected !== today) saveLastDailySelection(selected);
    setOpen(false);
    if (useUiStore.getState().dailyChallengeOrigin === 'newgame') setNewGameOpen(true);
  };

  const backdrop = useModalBackdrop(onDismiss);

  // Load authoritative "today", completed-day results, and the last-selected day
  // on open. Pre-selects the persisted last day when it differs from today
  // (otherwise defaults to today), and navigates the grid to that month.
  useEffect(() => {
    if (!open) return undefined;
    userPicked.current = false;
    let cancelled = false;
    Promise.all([
      loadAllDailyResults(),
      loadLastDailySelection(),
      fetchServerNow(),
    ]).then(([rows, lastSel, ms]) => {
      if (cancelled) return;
      const map = {};
      rows.forEach((r) => { map[r.date] = r; });
      setResults(map);
      const { y, m, d } = utcToYMD(ms);
      const todayStr = toDateStr(y, m, d);
      setToday(todayStr);
      if (userPicked.current) return;
      // A preferred initial date (e.g. advanced after a daily win) takes
      // precedence over the persisted last-selection, then is consumed.
      const preferred = useUiStore.getState().dailyChallengeInitialDate;
      let initial;
      if (preferred && withinSupported(preferred)) {
        initial = preferred;
        useUiStore.getState().setDailyChallengeInitialDate(null);
      } else {
        initial = (lastSel && lastSel !== todayStr) ? lastSel : todayStr;
      }
      if (!withinSupported(initial)) initial = todayStr;
      const ini = utcToYMD(dateToUTC(initial));
      setViewY(ini.y);
      setViewM(ini.m);
      setSelected(initial);
    });
    return () => { cancelled = true; };
  }, [open]);

  // Focus the panel when the dialog opens.
  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => panelRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  if (!open) return null;

  const onPlay = () => {
    if (!selected) return;
    if (isAfter(selected, today) || !withinSupported(selected)) return;
    const ok = dealDaily(selected);
    if (ok) {
      // Remember the picked day only when it differs from today, so the calendar
      // re-opens there next time (persisted in the DB).
      if (selected !== today) saveLastDailySelection(selected);
      setOpen(false);
    }
  };

  // Jump the grid back to today and select it.
  const onGoToday = () => {
    const ini = utcToYMD(dateToUTC(today));
    setViewY(ini.y);
    setViewM(ini.m);
    setSelected(today);
    userPicked.current = true;
  };

  const prev = addMonths(viewY, viewM, -1);
  const next = addMonths(viewY, viewM, 1);
  const canPrev = isSupportedYM(prev.y, prev.m);
  const canNext = isSupportedYM(next.y, next.m);
  const years = listSupportedYears();
  const monthsInYear = Array.from({ length: 12 }, (_, i) => i + 1);

  const selectedResult = selected ? results[selected] : null;

  // Build the 31-cell day grid (days 1..31, the maximum day-of-month).
  const cells = [];
  for (let d = 1; d <= 31; d++) {
    const dateStr = toDateStr(viewY, viewM, d);
    const validDay = d <= daysInMonth(viewY, viewM);
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
          onClick={() => { userPicked.current = true; setSelected(dateStr); }}
          aria-pressed={isSel}
          aria-label={`Day ${d}${completed ? ' (completed)' : ''}${isToday ? ' (today)' : ''}`}
        >
          {d}
        </button>,
      );
    } else {
      cells.push(
        <div key={d} className={classes.join(' ')} aria-hidden="true">
          {validDay ? d : ''}
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
        <h2 style={{ margin: '0 0 14px', fontSize: 20, fontWeight: 800, textAlign: 'center' }}>
          Daily Challenge
        </h2>

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
              {'◀'}
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
              {'▶'}
            </button>
          </div>

          {/* Body: calendar grid + side panel */}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <div style={gridStyle}>{cells}</div>
              <p style={{ margin: '10px 0 0', fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>
                <span style={{ display: 'inline-flex', gap: 12, flexWrap: 'wrap' }}>
                  <span><span className="dc-swatch dc-cell--today" /> Today</span>
                  <span><span className="dc-swatch dc-cell--completed" /> Completed</span>
                  <span><span className="dc-swatch dc-cell--selected" /> Selected</span>
                </span>
              </p>
            </div>

            <div style={{ flex: '1 1 220px', minWidth: 200, borderLeft: '1px solid var(--card-border)', paddingLeft: 16 }}>
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
                <div style={{ color: 'var(--card-text-black)', opacity: 0.75 }}>Select a day to see its best result.</div>
              )}
            </div>
          </div>

          {/* Footer actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" style={btn} onClick={onDismiss}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!selected}
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
