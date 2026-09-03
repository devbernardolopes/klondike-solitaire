// components/WinModal.jsx
// Modal shown when the game is won. Displays the finished game's Score, Time and
// Moves. Any of those that beat the stored best are rendered in a distinct
// (green) color with a small reddish "new" badge; the others use the normal
// theme text color. Two buttons let the player start a new game in the current
// mode or replay the exact same deal. Dismissed by clicking outside the panel,
// pressing Escape, or either button.

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../hooks/useUiStore.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import { useGameStore } from '../hooks/useGameStore.js';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEnter } from '../render/animation/useModalEnter.js';
import { dateToUTC, toDateStr, withinSupported, isAfter } from '../core/dailyChallenge.js';
import { utcToYMD, getCachedServerNow, getFallbackUTC } from '../utils/serverTime.js';
import { formatTime } from '../utils/formatTime.js';

// Color used for a value that is a new record (distinct from normal text).
const NEW_VALUE_COLOR = '#1a7f37';
// Color of the small "new" badge next to a new record.
const NEW_BADGE_COLOR = '#e53935';

export default function WinModal() {
  const { t } = useTranslation();
  const winDialogOpen = useUiStore((s) => s.winDialogOpen);
  const summary = useUiStore((s) => s.winSummary);
  const closeWinDialog = useUiStore((s) => s.closeWinDialog);
  const setDailyChallengeDialogOpen = useUiStore((s) => s.setDailyChallengeDialogOpen);
  const setDailyChallengeOrigin = useUiStore((s) => s.setDailyChallengeOrigin);
  const setSpecialEventsOpen = useUiStore((s) => s.setSpecialEventsOpen);
  const setEventDetailOpen = useUiStore((s) => s.setEventDetailOpen);
  const dealNewGame = useGameStore((s) => s.dealNewGame);
  const replayGame = useGameStore((s) => s.replayGame);

  const panelRef = useRef(null);

  // Entrance animation: the panel grows from a tiny centered size to full size.
  // While it is still animating (`entering`), the modal must not be dismissable
  // or interactable — so both the backdrop close and Escape are gated, and the
  // panel itself blocks pointer/keyboard input (and is aria-hidden). Focus only
  // moves to the panel once the entrance completes.
  const entering = useModalEnter({
    panelRef,
    open: winDialogOpen,
    onEnterDone: () => panelRef.current?.focus(),
  });

  const backdrop = useModalBackdrop(entering ? () => {} : closeWinDialog);

  // Focus the panel on open; Escape closes only when this is the topmost modal
  // and the entrance animation has finished.
  useModalEscape({ open: winDialogOpen, onClose: closeWinDialog, id: 'win', z: Z.BASE, enabled: !entering });

  if (!winDialogOpen || !summary) return null;

  const { score, timeMs, moves, newScore, newTime, newMoves, bestScore, bestTimeMs, bestMoves, dailyDate, eventDealId, eventTitle, seed } = summary;

  const onNewGame = () => {
    closeWinDialog();
    dealNewGame(useUiStore.getState().lastNewGameMode);
  };
  const onReplay = () => {
    closeWinDialog();
    replayGame();
  };
  const onReturnDaily = () => {
    closeWinDialog();
    // Land the calendar one day ahead of the day just won (whenever such a day
    // is still within the supported window AND already available — i.e. not in
    // the future relative to today), so the player is invited to play the next
    // daily. When the won day is the last available one there is no playable
    // next day, so we leave the initial date unset and the modal keeps the
    // selector on the day just played. Cleared by the modal once consumed.
    if (dailyDate) {
      const adv = utcToYMD(dateToUTC(dailyDate) + 86400000);
      const nextDay = toDateStr(adv.y, adv.m, adv.d);
      const nowMs = getCachedServerNow() != null ? getCachedServerNow() : getFallbackUTC();
      const { y, m, d } = utcToYMD(nowMs);
      const todayStr = toDateStr(y, m, d);
      if (withinSupported(nextDay) && !isAfter(nextDay, todayStr)) {
        useUiStore.getState().setDailyChallengeInitialDate(nextDay);
      }
    }
    // The Win modal is already dismissed here, so returning to the Daily
    // Challenge leaves no modal behind when this one is closed.
    setDailyChallengeOrigin('win');
    setDailyChallengeDialogOpen(true);
  };
  const onReturnEvent = () => {
    closeWinDialog();
    // Open the events list modal first (so it sits underneath the detail
    // modal at z=CHILD). Then open the detail modal directly to this event —
    // EventDetailModal's own useEffect (EventDetailModal.jsx:76-95) lands on
    // the first unlocked-but-not-yet-completed page, which after a fresh win
    // is the page containing the just-won deal. Closing the detail modal then
    // naturally reveals the list, mirroring the daily-return flow.
    setSpecialEventsOpen(true);
    setEventDetailOpen(useUiStore.getState().currentEventId);
  };

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
    background: 'var(--ui-modal-panel-bg)',
    color: 'var(--ui-modal-panel-fg)',
    border: 'var(--ui-modal-panel-border)',
    borderRadius: 'var(--ui-modal-panel-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '22px 24px',
    width: 'min(90vw, 380px)',
    maxWidth: '100%',
    outline: 'none',
    transformOrigin: 'center center',
    pointerEvents: entering ? 'none' : 'auto',
  };

  // Column header: "Current" and "Best" sit above the two value columns.
  const HeaderRow = () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 8,
        paddingBottom: 4,
        marginBottom: 2,
        borderBottom: '2px solid var(--ui-modal-panel-border)',
      }}
    >
      <span />
      <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
        {t('winModal.current')}
      </span>
      <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
        {t('winModal.best')}
      </span>
    </div>
  );

  // A single stat row: label, current value (green + red "new" badge when a
  // record), and the best value in the second column.
  const StatRow = ({ label, value, best, isNew }) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        alignItems: 'baseline',
        gap: 8,
        padding: '8px 0',
        borderBottom: '1px solid var(--ui-modal-panel-border)',
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 6 }}>
        <span
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: isNew ? NEW_VALUE_COLOR : 'var(--ui-modal-panel-fg)',
          }}
        >
          {value}
        </span>
        {isNew && (
          <span style={{ fontSize: 12, fontWeight: 700, color: NEW_BADGE_COLOR }}>
            {t('common.new')}
          </span>
        )}
      </span>
      <span
        style={{
          fontSize: 18,
          fontWeight: 700,
          textAlign: 'right',
                color: 'var(--ui-modal-panel-fg)',
          opacity: 0.8,
        }}
      >
        {best}
      </span>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('winModal.title')}
      {...backdrop}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
        padding: 16,
      }}
    >
       <div ref={panelRef} tabIndex={-1} aria-hidden={entering} style={panel}>
          <h2
            style={{
              margin: '0 0 14px',
              fontSize: 22,
              fontWeight: 800,
              textAlign: 'center',
            }}
          >
            {t('winModal.title')}
          </h2>

         {dailyDate && (
           <div
             style={{
               textAlign: 'center',
               fontSize: 14,
               fontWeight: 600,
               margin: '0 0 14px',
          color: 'var(--ui-modal-panel-fg)',
               opacity: 0.85,
             }}
           >
              {t('winModal.dailyBanner', { date: dailyDate, seed })}
           </div>
         )}

         {eventDealId && (
           <div
             style={{
               textAlign: 'center',
               fontSize: 14,
               fontWeight: 600,
               margin: '0 0 14px',
               color: 'var(--ui-modal-panel-fg)',
               opacity: 0.85,
             }}
           >
             {t('winModal.eventBanner', { title: eventTitle || t('winModal.eventFallbackTitle'), seed })}
           </div>
         )}

          <div style={{ marginBottom: 18 }}>
           <HeaderRow />
           <StatRow label={t('winModal.score')} value={String(score)} best={String(bestScore)} isNew={newScore} />
           <StatRow
             label={t('winModal.time')}
             value={formatTime(timeMs)}
             best={bestTimeMs == null ? '—' : formatTime(bestTimeMs)}
             isNew={newTime}
           />
           <StatRow
             label={t('winModal.moves')}
             value={String(moves)}
             best={bestMoves == null ? '—' : String(bestMoves)}
             isNew={newMoves}
           />
         </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'stretch' }}>
           <button
             type="button"
             style={{ ...btn, flex: 1 }}
             onClick={onReplay}
           >
             {t('winModal.replay')}
           </button>
           {dailyDate ? (
             <button
               type="button"
               style={{ ...btn, flex: 1, background: 'var(--ui-modal-btn-bg-strong)' }}
               onClick={onReturnDaily}
             >
               {t('winModal.returnDaily')}
             </button>
           ) : eventDealId ? (
             <button
               type="button"
               style={{ ...btn, flex: 1, background: 'var(--ui-modal-btn-bg-strong)' }}
               onClick={onReturnEvent}
             >
               {t('winModal.returnEvent')}
             </button>
           ) : (
             <button
               type="button"
               style={{ ...btn, flex: 1, background: 'var(--ui-modal-btn-bg-strong)' }}
               onClick={onNewGame}
             >
               {t('winModal.newGame')}
             </button>
           )}
         </div>
      </div>
    </div>
  );
}
