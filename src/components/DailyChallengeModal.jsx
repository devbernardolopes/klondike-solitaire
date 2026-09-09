// components/DailyChallengeModal.jsx
// Calendar picker for the Daily Challenge. Shows a month grid (days 1..31), lets
// the player navigate by month/year, marks already-completed days and "today",
// disables future / out-of-window days, and starts the selected day's deal via
// the "Play" button. A side panel shows the selected day's best result.
//
// "Today" is sourced from a public time API (utils/serverTime) and never from
// the device clock. The deal seed for each day is pre-generated and bundled
// (core/dailyChallenge.seedForDate).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

const MONTH_NAMES_FALLBACK = [
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
  // Allow vertical scroll/pan inside the modal while letting pointer events
  // for horizontal swipes flow through to the panel's own handlers. Matches
  // EventDetailModal.jsx's viewport setup.
  touchAction: 'pan-y',
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
  const { t } = useTranslation();
  const open = useUiStore((s) => s.dailyChallengeDialogOpen);
  const dealDaily = useGameStore((s) => s.dealDaily);

  const MONTH_NAMES = (() => {
    const v = t('dailyChallenge.months', { returnObjects: true });
    return Array.isArray(v) ? v : MONTH_NAMES_FALLBACK;
  })();

  const setOpen = useUiStore((s) => s.setDailyChallengeDialogOpen);
  const setNewGameOpen = useUiStore((s) => s.setNewGameDialogOpen);

  const panelRef = useRef(null);
  const viewportRef = useRef(null);
  // Cooldown timestamp for wheel navigation: one notch/flick = one month.
  const wheelLockRef = useRef(0);
  // Latest month-step callbacks for the wheel listener (attached once per
  // open, so it reads through this ref instead of stale closures).
  const navRef = useRef({ prev: () => {}, next: () => {} });
  const userPicked = useRef(false);
  // Mirror of `selected` / `today` (state) for reads inside async callbacks
  // without re-running effects; and the open-time {today, selected, usedPreferred}
  // triple so a background refresh can tell whether selection was still
  // "today-bound" or advanced by a win, and therefore must not be overridden.
  const selectedRef = useRef(null);
  const todayRef = useRef(fallbackDate);
  const initialRef = useRef({ today: null, selected: null, usedPreferred: false });
  // Horizontal-swipe gesture state. Mirrors EventDetailModal.jsx. Vertical
  // wheel navigation is handled by a separate native listener (see below).
  const SWIPE_THRESHOLD_RATIO = 0.2;
  const dragStateRef = useRef({ startX: 0, startY: 0, width: 1, active: false, committed: false, pointerId: null });
  const justSwipedRef = useRef(false);
  const justSwipedTimerRef = useRef(null);
  // Slide-track state. The body is rendered as a 3-slot flex track
  // [prev | current | next] and translated horizontally to follow a swipe
  // and to animate a programmatic step (arrow buttons, keyboard, swipe).
  // The resting transform is -100% (the middle slot). slideIndex shifts
  // around that base:
  //   slideIndex ∈ {-1, 0, 1}
  //                        0 = resting, the viewport shows the current month.
  //                       +1 = slid left one slot (about to commit a "next"
  //                            navigation; the viewport shows the next month).
  //                       -1 = slid right one slot (about to commit a "prev"
  //                            navigation; the viewport shows the prev month).
  //   dragPx              — live finger offset added on top of slideIndex.
  //   dragging            — true while a swipe is in progress; used to
  //                         suppress the CSS transition so the track follows
  //                         the pointer 1:1.
  //   suppressTrackAnim   — disables the CSS transition for one commit, used
  //                         for open-time positioning, for short-drag snap-
  //                         back, and for the re-center step at the end of a
  //                         slide (so the swap of viewY/viewM doesn't visibly
  //                         shift the track).
  //   slideBump           — counter so the trackTransform memo recomputes
  //                         when slideIndex changes (refs aren't reactive).
  const [slideIndex, setSlideIndex] = useState(0);
  const [suppressTrackAnim, setSuppressTrackAnim] = useState(true);
  const [slideBump, setSlideBump] = useState(0);
  const [dragPx, setDragPx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const slideTimerRef = useRef(null);
  const suppressTimerRef = useRef(null);

  // Mirrors the 0.3s ease used by EventDetailModal.jsx (line 579). A short
  // 20 ms slack on the commit timer covers slow frames / subpixel rendering.
  const SLIDE_MS = 300;

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
    // Reset the slide track to slot 0 with the transition suppressed, so
    // the first paint after open lands on the right month without sliding
    // from a default position. Mirrors EventDetailModal.jsx:181-217.
    if (suppressTimerRef.current) { clearTimeout(suppressTimerRef.current); suppressTimerRef.current = null; }
    if (slideTimerRef.current) { clearTimeout(slideTimerRef.current); slideTimerRef.current = null; }
    setDragPx(0);
    setSlideIndex(0);
    setSlideBump((b) => b + 1);
    setSuppressTrackAnim(true);
    suppressTimerRef.current = setTimeout(() => {
      suppressTimerRef.current = null;
      setSuppressTrackAnim(false);
    }, 60);
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
        jumpTo(ini.y, ini.m);
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

  // Clear any pending post-swipe click-suppression timer on unmount so a
  // stale timer can't fire after the modal closes (mirrors the cleanup
  // EventDetailModal.jsx performs for its own justSwipedTimerRef). Also
  // cancels the slide-commit and transition-suppression timers so a half-
  // finished animation doesn't try to commit a viewY/viewM after the modal
  // is gone.
  useEffect(() => () => {
    if (justSwipedTimerRef.current) {
      clearTimeout(justSwipedTimerRef.current);
      justSwipedTimerRef.current = null;
    }
    if (slideTimerRef.current) {
      clearTimeout(slideTimerRef.current);
      slideTimerRef.current = null;
    }
    if (suppressTimerRef.current) {
      clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
  }, []);

  // Pull the linked account's latest progress when the calendar opens, so
  // completion marks / bests reflect what another device has done.
  useEffect(() => {
    if (open && !useAuthStore.getState().isAnonymous) {
      pullRemoteProfile().catch((e) => console.error('Daily Challenge profile pull failed', e));
    }
  }, [open]);

  // trackTransform follows the same translateX(calc(-idx*100% + dragPx))
  // pattern as EventDetailModal.jsx, shifted by the -100% resting base so
  // the middle slot (the current month) is visible at rest. MUST be
  // declared before the open-gate early return below — otherwise the closed
  // render skips it and the open render adds a new hook, tripping React's
  // Rules of Hooks.
  const trackTransform = useMemo(
    () => `translateX(calc(${-(1 + slideIndex) * 100}% + ${dragPx}px))`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slideIndex, dragPx, slideBump]
  );

  // Vertical mouse wheel steps months (down → next, up → prev) through the
  // same slideTo path as arrows/drag. MUST stay above the open-gate early
  // return below (Rules of Hooks: the closed render skips everything past
  // it). Native non-passive listener — React's onWheel can't preventDefault
  // — following PostcardViewerModal.jsx. The cooldown covers the 0.3s slide
  // so one notch moves exactly one month; a wheel during an active drag is
  // ignored. Edge months are no-ops via the canPrev/canNext gates inside
  // goPrevMonth/goNextMonth (read through navRef, assigned below).
  useEffect(() => {
    if (!open) return undefined;
    const el = viewportRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (dragStateRef.current.active) return;
      const dy = e.deltaY;
      if (!dy || Number.isNaN(dy)) return;
      const now = Date.now();
      if (now - wheelLockRef.current < 350) return;
      e.preventDefault();
      wheelLockRef.current = now;
      if (dy > 0) navRef.current.next();
      else navRef.current.prev();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open]);

  if (!open) return null;

  const onPlay = () => {
    if (!selected) return;
    if (isAfter(selected, today) || !withinSupported(selected)) return;
    const run = async () => {
      const ok = await dealDaily(selected);
      if (ok) {
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

  // Pick the day to select when landing on (y, m): today when the target
  // month is today's month and today is playable, otherwise the first
  // playable day of the month. Returns null when the month has no playable
  // day (should not happen for supported months, but defensive).
  const pickDayForMonth = (y, m, todayStr) => {
    const t = todayStr ?? todayRef.current;
    if (t) {
      const ty = Number(String(t).slice(0, 4));
      const tm = Number(String(t).slice(5, 7));
      if (ty === y && tm === m && withinSupported(t) && !isAfter(t, todayRef.current ?? t)) return t;
    }
    const dim = daysInMonth(y, m);
    for (let d = 1; d <= dim; d++) {
      const ds = toDateStr(y, m, d);
      if (withinSupported(ds) && !isAfter(ds, todayRef.current ?? ds)) return ds;
    }
    return null;
  };

  // Ensure the selection lives in (y, m): keep it when it already does,
  // otherwise select today (if visible) or the first playable day. When
  // the month has no playable day at all, clear the selection so nothing
  // is highlighted and the Play button disables. Marks the choice as
  // user-picked so background today-refreshes don't override an explicit
  // navigation.
  const ensureSelectedInMonth = (y, m) => {
    const cur = selectedRef.current;
    if (cur) {
      const cy = Number(String(cur).slice(0, 4));
      const cm = Number(String(cur).slice(5, 7));
      if (cy === y && cm === m) return;
    }
    const pick = pickDayForMonth(y, m, todayRef.current);
    applySelected(pick);
    userPicked.current = true;
  };

  // Jump the grid back to today and select it. Uses jumpTo so a "today"
  // tap from a far month doesn't slide across N months — instant, like a
  // year/month <select> change.
  const onGoToday = () => {
    const todayStr = todayRef.current ?? today;
    const ini = utcToYMD(dateToUTC(todayStr));
    jumpTo(ini.y, ini.m);
    if (withinSupported(todayStr)) {
      applySelected(todayStr);
      userPicked.current = true;
    } else {
      ensureSelectedInMonth(ini.y, ini.m);
    }
  };

  const prev = addMonths(viewY, viewM, -1);
  const next = addMonths(viewY, viewM, 1);
  const canPrev = isSupportedYM(prev.y, prev.m);
  const canNext = isSupportedYM(next.y, next.m);
  const years = listSupportedYears();
  const monthsInYear = Array.from({ length: 12 }, (_, i) => i + 1);

  // Step the viewed month by one with a horizontal slide. The two-phase
  // approach mirrors EventDetailModal.jsx's `positionWithoutAnim` pattern:
  // first shift the track by one slot in the chosen direction and let the
  // 0.3s ease animate it (drag offset is cleared in the same commit so the
  // transition runs from the finger position to the target slot, exactly
  // like the events modal), then commit the new viewY/viewM, re-center the
  // track, and suppress the brief re-center transition so the content swap
  // is invisible. Gated by canPrev/canNext so a swipe, wheel, or key at the
  // supported-window edge is a no-op. A leftward finger drag (dx < 0)
  // reveals the next month (track moves left to -200%); a rightward drag
  // reveals the previous month (track moves right to 0%).
  const slideTo = (delta, target) => {
    if (slideTimerRef.current) clearTimeout(slideTimerRef.current);
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    setDragPx(0);
    setSlideIndex(delta);
    setSuppressTrackAnim(false);
    slideTimerRef.current = setTimeout(() => {
      slideTimerRef.current = null;
      setViewY(target.y);
      setViewM(target.m);
      setSlideIndex(0);
      setSlideBump((b) => b + 1);
      setSuppressTrackAnim(true);
      ensureSelectedInMonth(target.y, target.m);
      suppressTimerRef.current = setTimeout(() => {
        suppressTimerRef.current = null;
        setSuppressTrackAnim(false);
      }, 60);
    }, SLIDE_MS + 20);
  };

  const goPrevMonth = () => {
    if (!canPrev) return;
    slideTo(-1, { y: prev.y, m: prev.m });
  };
  const goNextMonth = () => {
    if (!canNext) return;
    slideTo(+1, { y: next.y, m: next.m });
  };
  navRef.current = { prev: goPrevMonth, next: goNextMonth };

  // Far jumps from the year/month <select>s skip the slide (the destination
  // isn't an adjacent slot, so animating across N months would feel laggy).
  // We still reset the track state and suppress the transition for one
  // commit so the rendered content swap is instant, matching the open-time
  // positioning behavior in EventDetailModal.jsx.
  const jumpTo = (y, m) => {
    if (!isSupportedYM(y, m)) return;
    if (slideTimerRef.current) { clearTimeout(slideTimerRef.current); slideTimerRef.current = null; }
    if (suppressTimerRef.current) { clearTimeout(suppressTimerRef.current); suppressTimerRef.current = null; }
    setDragPx(0);
    setSlideIndex(0);
    setSlideBump((b) => b + 1);
    setSuppressTrackAnim(true);
    setViewY(y);
    setViewM(m);
    ensureSelectedInMonth(y, m);
    suppressTimerRef.current = setTimeout(() => {
      suppressTimerRef.current = null;
      setSuppressTrackAnim(false);
    }, 60);
  };

  // Swipe threshold mirrors EventDetailModal.jsx: 20% of the viewport width.
  // Direction is the player's finger: a leftward drag (dx < 0) advances to
  // the next month, matching the right-pointing arrow.
  const onViewportPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Don't hijack the month/year dropdowns — those have their own native
    // open/keyboard behavior. Day cells are intentionally NOT excluded: a
    // tap still selects via click, while a drag becomes a month swipe (the
    // post-swipe click-suppression below swallows the accidental select).
    const tag = e.target?.tagName;
    if (tag === 'SELECT' || tag === 'OPTION') return;
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      width: viewportRef.current?.clientWidth || 1,
      active: true,
      committed: false,
      pointerId: e.pointerId,
    };
  };

  const onViewportPointerMove = (e) => {
    if (!dragStateRef.current.active) return;
    const dx = e.clientX - dragStateRef.current.startX;
    const dy = e.clientY - dragStateRef.current.startY;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) return; // vertical gesture
    if (!dragStateRef.current.committed && Math.abs(dx) > 10) {
      try { e.currentTarget.setPointerCapture(dragStateRef.current.pointerId); } catch {}
      dragStateRef.current.committed = true;
      setDragging(true);
    }
    if (dragStateRef.current.committed) {
      // Live-track the finger: the slide track follows the drag offset until
      // release (matches EventDetailModal.jsx's dragPx pattern). Suppress the
      // CSS transition while dragging so the motion is 1:1 with the pointer.
      // The -100% resting base lives in trackTransform; dragPx is just the
      // finger offset on top of it.
      setSuppressTrackAnim(true);
      setDragPx(dx);
    }
  };

  const endViewportDrag = (e) => {
    if (!dragStateRef.current.active) return;
    const { committed, pointerId, startX, width } = dragStateRef.current;
    if (committed && e?.currentTarget && typeof e.currentTarget.hasPointerCapture === 'function'
      && e.currentTarget.hasPointerCapture(pointerId)) {
      try { e.currentTarget.releasePointerCapture(pointerId); } catch {}
    }
    if (committed) {
      const releaseX = e?.clientX ?? startX;
      const dx = releaseX - startX;
      const threshold = (width || 1) * SWIPE_THRESHOLD_RATIO;
      if (dx <= -threshold) {
        goNextMonth();
      } else if (dx >= threshold) {
        goPrevMonth();
      } else {
        // Short drag — snap back to the resting slot. Re-enable the
        // transition and clear dragPx so the track eases back to -100%.
        setSuppressTrackAnim(false);
        setDragPx(0);
      }
      // Swallow the synthetic click that the browser fires at the release
      // point — it can land on a day cell and accidentally select it. The
      // 250 ms window matches EventDetailModal.jsx's justSwipedRef guard.
      justSwipedRef.current = true;
      if (justSwipedTimerRef.current) clearTimeout(justSwipedTimerRef.current);
      justSwipedTimerRef.current = setTimeout(() => {
        justSwipedRef.current = false;
        justSwipedTimerRef.current = null;
      }, 250);
    }
    dragStateRef.current.active = false;
    dragStateRef.current.committed = false;
    setDragging(false);
  };

  const handleViewportClickCapture = (e) => {
    if (justSwipedRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const onPanelKeyDown = (e) => {
    // A focused <select> already absorbs Arrow keys for its own list
    // navigation; only react when the panel itself (or a non-select child)
    // has focus.
    const tag = e.target?.tagName;
    if (tag === 'SELECT' || tag === 'OPTION') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); goPrevMonth(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goNextMonth(); }
  };

  // Build the day grid for the actual days of a given (y, m). Extracted from
  // the render body so the 3-slot slide track can render prev/current/next
  // independently with the same logic.
  const buildCells = (y, m) => {
    const out = [];
    const dim = daysInMonth(y, m);
    for (let d = 1; d <= dim; d++) {
      const dateStr = toDateStr(y, m, d);
      const supported = withinSupported(dateStr);
      const future = isAfter(dateStr, today);
      const enabled = supported && !future;
      const completed = !!results[dateStr];
      const isToday = dateStr === today;
      const isSel = dateStr === selected;

      const classes = ['dc-cell'];
      if (!enabled) classes.push('dc-cell--disabled');
      if (completed) classes.push('dc-cell--completed');
      if (isToday) classes.push('dc-cell--today');
      if (isSel) classes.push('dc-cell--selected');

      if (enabled) {
        out.push(
          <button
            key={d}
            type="button"
            className={classes.join(' ')}
            onClick={() => { userPicked.current = true; applySelected(dateStr); }}
            aria-pressed={isSel}
            aria-label={`${t('dailyChallenge.dayAria', { d })}${completed ? t('dailyChallenge.dayCompleted') : ''}${isToday ? t('dailyChallenge.dayToday') : ''}`}
          >
            {d}
          </button>,
        );
      } else {
        out.push(
          <div key={d} className={classes.join(' ')} aria-hidden="true">
            {d}
          </div>,
        );
      }
    }
    return out;
  };

  // Side panel for the day currently shown in a given slot. For the prev /
  // next slots, the day isn't in `selected` (a date from another month) so
  // they render the empty-state copy. The current slot uses the live
  // `selected` exactly as before.
  const renderSidePanel = (slotY, slotM) => {
    let dateStr = null;
    if (slotY === viewY && slotM === viewM) dateStr = selected;
    if (!dateStr) {
      return (
        <div style={{ flex: '1 1 220px', minWidth: 200, borderLeft: '1px solid var(--ui-modal-panel-border)', paddingLeft: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>{t('dailyChallenge.bestResult')}</h3>
          <div style={{ color: 'var(--ui-modal-panel-fg)', opacity: 0.75 }}>{t('dailyChallenge.selectDay')}</div>
        </div>
      );
    }
    const result = results[dateStr];
    return (
      <div style={{ flex: '1 1 220px', minWidth: 200, borderLeft: '1px solid var(--ui-modal-panel-border)', paddingLeft: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>{t('dailyChallenge.bestResult')}</h3>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>{dateStr}</div>
          <div>{t('dailyChallenge.seed', { seed: result ? result.seed : seedForDate(dateStr) })}</div>
          <div style={{ display: 'none' }}>{t('dailyChallenge.bestScore', { value: result ? result.bestScore : 0 })}</div>
          <div>{t('dailyChallenge.bestTime', { value: result ? formatTime(result.bestTimeMs) : formatTime(0) })}</div>
          <div>{t('dailyChallenge.bestMoves', { value: result ? result.bestMoves : 0 })}</div>
          <div style={{ opacity: 0.7 }}>
            {t('dailyChallenge.completedTimes', { count: result ? result.wins : 0 })}
          </div>
        </div>
      </div>
    );
  };

  // 3-slot body: [prev | current | next]. The track is translated by
  // `trackTransform` to show the right slot in the viewport. The two outer
  // slots exist only so the slide has somewhere to animate from/to — they're
  // aria-hidden so screen readers don't read three months.
  const prevDims = prev;
  const nextDims = next;
  const slotCellStyle = {
    flex: '0 0 100%',
    minWidth: 0,
    display: 'flex',
    gap: 18,
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    padding: '0 4px',
    boxSizing: 'border-box',
  };
  const slotGridWrapStyle = {
    flex: '1 1 320px',
    minWidth: 280,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('dailyChallenge.title')}
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
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        style={panel}
      >
        <h2 style={{ margin: '0 0 14px', fontSize: 20, fontWeight: 800, textAlign: 'center', paddingRight: 36 }}>
          {t('dailyChallenge.title')}
        </h2>
        <ModalCloseButton onClick={onDismiss} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Header: arrows + month/year selectors */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 44px' }}>
            <button
              type="button"
              aria-label={t('dailyChallenge.prevMonth')}
              disabled={!canPrev}
              onClick={goPrevMonth}
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
                aria-label={t('dailyChallenge.month')}
                value={viewM}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  if (isSupportedYM(viewY, m)) jumpTo(viewY, m);
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
                aria-label={t('dailyChallenge.year')}
                value={viewY}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  if (isSupportedYM(y, viewM)) { jumpTo(y, viewM); return; }
                  // Edge year where the current month is unsupported (e.g.
                  // anchor/end year): clamp to the nearest supported month
                  // in that year instead of silently doing nothing.
                  const supported = monthsInYear.filter((m) => isSupportedYM(y, m));
                  if (supported.length > 0) {
                    const clamped = viewM < supported[0] ? supported[0] : supported[supported.length - 1];
                    jumpTo(y, clamped);
                  }
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
              aria-label={t('dailyChallenge.nextMonth')}
              disabled={!canNext}
              onClick={goNextMonth}
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

          {/* Body: calendar grid + side panel, wrapped in a clipped viewport
              with a 3-slot flex track so swipe / wheel / arrow / keyboard can slide
              the inner content horizontally with a 0.3s ease. The header
              (above) and footer (below) stay put. Swipe handlers live on
              this viewport (like EventDetailModal.jsx) so a drag starting
              anywhere on the body — including day cells — is captured. */}
          <div
            ref={viewportRef}
            onPointerDown={onViewportPointerDown}
            onPointerMove={onViewportPointerMove}
            onPointerUp={endViewportDrag}
            onPointerCancel={endViewportDrag}
            onClickCapture={handleViewportClickCapture}
            style={{ overflow: 'hidden', touchAction: 'pan-y' }}
          >
            <div
              style={{
                display: 'flex',
                transform: trackTransform,
                transition: dragging || suppressTrackAnim ? 'none' : 'transform 0.3s ease',
                willChange: 'transform',
              }}
            >
              <div
                key={`slot-prev-${prevDims.y}-${prevDims.m}`}
                aria-hidden="true"
                style={slotCellStyle}
              >
                <div style={slotGridWrapStyle}>
                  <div style={{ ...gridStyle, minHeight: '214px', alignContent: 'start' }}>
                    {buildCells(prevDims.y, prevDims.m)}
                  </div>
                </div>
                {renderSidePanel(prevDims.y, prevDims.m)}
              </div>
              <div
                key={`slot-cur-${viewY}-${viewM}`}
                style={slotCellStyle}
              >
                <div style={slotGridWrapStyle}>
                  <div style={{ ...gridStyle, minHeight: '214px', alignContent: 'start' }}>
                    {buildCells(viewY, viewM)}
                  </div>
                </div>
                {renderSidePanel(viewY, viewM)}
              </div>
              <div
                key={`slot-next-${nextDims.y}-${nextDims.m}`}
                aria-hidden="true"
                style={slotCellStyle}
              >
                <div style={slotGridWrapStyle}>
                  <div style={{ ...gridStyle, minHeight: '214px', alignContent: 'start' }}>
                    {buildCells(nextDims.y, nextDims.m)}
                  </div>
                </div>
                {renderSidePanel(nextDims.y, nextDims.m)}
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
            <button
              type="button"
              aria-label={t('dailyChallenge.goToToday')}
              title={t('dailyChallenge.goToToday')}
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
              {t('dailyChallenge.play')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
