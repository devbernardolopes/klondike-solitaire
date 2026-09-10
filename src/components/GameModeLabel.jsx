// components/GameModeLabel.jsx
// Shared game-mode deal label (e.g. "Autumn Cup, Deal 4 (123444555)").
// Rendered in the Advanced modal and mirrored on the main game screen footer.
// Show rule and double-click/tap rule are identical in both places by design:
// visible whenever `currentGameKind` is set (nbsp placeholder otherwise), and a
// double-click / double-tap (pointer-based, so touch works) opens Seed Input.

import { useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useGameStore } from '../hooks/useGameStore.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { getCachedEventDetailSync } from '../repo/specialEventsRepository.js';

export const SEED_LABEL_DOUBLE_MS = 300;
export const SEED_LABEL_DOUBLE_DIST = 24;

/**
 * Resolve the event-sequential Deal N for the deal label. Prefers the number
 * carried on the deal itself; falls back to the in-memory cached event detail
 * (covers sessions restored from a pre-number replaySpec, where the deal id
 * survived but the number did not). Returns '…' when unknown so the localized
 * "Special Event, Deal N (seed)" shape still renders.
 * @param {string|null} eventId
 * @param {number|null} dealId
 * @param {number|null} dealNumber
 */
export function resolveEventDealNumber(eventId, dealId, dealNumber) {
  if (dealNumber != null) return dealNumber;
  try {
    if (eventId && dealId != null) {
      const detail = getCachedEventDetailSync(eventId);
      for (const p of detail?.pages || []) {
        const found = (p.deals || []).find((d) => d.id === dealId);
        if (found && found.dealNumber != null) return found.dealNumber;
      }
    }
  } catch {}
  return '…';
}

/**
 * @param {object} props
 * @param {'modal'|'hud'} [props.variant] modal keeps inherited dialog colors,
 * hud renders white for felt contrast.
 */
export default function GameModeLabel({ variant = 'modal' }) {
  const { t } = useTranslation();
  const seed = useGameStore((s) => s.state.seed);
  const currentGameKind = useUiStore((s) => s.currentGameKind);
  const currentDailyDate = useUiStore((s) => s.currentDailyDate);
  const currentEventDealId = useUiStore((s) => s.currentEventDealId);
  const currentEventDealNumber = useUiStore((s) => s.currentEventDealNumber);
  const currentEventId = useUiStore((s) => s.currentEventId);
  const currentEventTitle = useUiStore((s) => s.currentEventTitle);

  const lastLabelTap = useRef(null);
  const onLabelActivate = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    const now = Date.now();
    const tap = { x: e.clientX ?? 0, y: e.clientY ?? 0, t: now };
    const prev = lastLabelTap.current;
    lastLabelTap.current = tap;
    if (
      prev &&
      now - prev.t < SEED_LABEL_DOUBLE_MS &&
      Math.hypot(tap.x - prev.x, tap.y - prev.y) < SEED_LABEL_DOUBLE_DIST
    ) {
      lastLabelTap.current = null;
      useUiStore.getState().setSeedInputDialogOpen(true);
    }
  }, []);

  if (!currentGameKind) return <span aria-hidden="true">{'\u00A0'}</span>;

  // Event deals are labeled with the event's own name ("Autumn Cup, Deal 4
  // (seed)"). The title rides the deal itself (setCurrentEventMeta); restored
  // sessions fall back to the cached event detail. Only when neither knows
  // the name does the generic "Special Event" shape render.
  let eventTitle = currentEventTitle;
  if (currentGameKind === 'event' && !eventTitle) {
    try {
      eventTitle = getCachedEventDetailSync(currentEventId)?.title ?? null;
    } catch {
      eventTitle = null;
    }
  }
  const dealNumber = currentGameKind === 'event'
    ? resolveEventDealNumber(currentEventId, currentEventDealId, currentEventDealNumber)
    : null;

  return (
    <span
      role="button"
      tabIndex={0}
      title={t('toolbar.seedHint')}
      onDoubleClick={onLabelActivate}
      onPointerUp={onLabelActivate}
      onKeyDown={onLabelActivate}
      style={
        variant === 'hud'
          ? {
              fontSize: 12,
              fontWeight: 600,
              userSelect: 'none',
              cursor: 'pointer',
              outline: 'none',
              color: '#fff',
              opacity: 0.85,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'inline-block',
              maxWidth: '100%',
            }
          : {
              fontSize: 13,
              fontWeight: 600,
              userSelect: 'none',
              cursor: 'pointer',
              outline: 'none',
            }
      }
    >
      {currentGameKind === 'daily'
        ? t('toolbar.dailyChallenge', { date: currentDailyDate, seed })
        : currentGameKind === 'random'
          ? t('toolbar.random', { seed })
          : currentGameKind === 'event'
            ? (eventTitle
              ? t('toolbar.specialEvent', { eventTitle, dealNumber, seed })
              : t('toolbar.specialEventUnknown', { dealNumber, seed }))
            : t('toolbar.winningDeal', { seed })}
    </span>
  );
}
