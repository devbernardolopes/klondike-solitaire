// components/FavoritesModal.jsx
// Favorited-deals list (Main Menu > Favorites). Layout mirrors HistoryModal:
// same 85vh flex panel, scrollport with up/down pills, and a non-scrolling
// footer total — but rows carry no won/lost badges (favorites are deals, not
// results). Each row is an entry button (title + favorited date) plus a
// heart toggle that asks for confirmation before unfavoriting.
//
// Data comes from useFavoritesStore (local-first Dexie mirror converging
// with Supabase via the outbox). Refreshes are stale-while-revalidate:
// background pulls (open, sync-flushed) never wipe the visible list.
// Clicking an entry asks for confirmation naming the deal (then deals
// through the New-Game confirm gate when a game is in progress).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Heart } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import { useUiStore } from '../hooks/useUiStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { useGameStore } from '../hooks/useGameStore.js';
import { useFavoritesStore } from '../hooks/useFavoritesStore.js';
import { formatHistoryDate } from '../utils/formatHistoryDate.js';
import { eventDealTitle } from '../utils/eventDealTitle.js';

function FavoriteRow({ entry, onPlay, onUnfavorite }) {
  const { t, i18n } = useTranslation();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const active = hover || focus;

  const kindLabel = eventDealTitle(entry, t);

  const dateLabel = formatHistoryDate(entry.favoritedAt, i18n.language) ?? '';

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
      <button
        type="button"
        onClick={() => onPlay(entry)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        aria-label={`${kindLabel} — ${dateLabel}`}
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: 'left',
          padding: '10px 12px',
          borderRadius: 6,
          border: '1px solid var(--ui-modal-btn-border)',
          background: active ? 'var(--ui-modal-btn-bg-strong)' : 'var(--ui-modal-btn-bg)',
          color: 'var(--ui-modal-fg)',
          cursor: 'pointer',
          outline: focus ? '2px solid var(--ui-modal-btn-border)' : 'none',
          outlineOffset: 1,
        }}
      >
        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {kindLabel}
        </span>
        {dateLabel && (
          <span style={{ display: 'block', fontSize: 12, opacity: 0.75, marginTop: 4 }}>
            {dateLabel}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onUnfavorite(entry)}
        aria-label={t('favorites.unfavorite', { title: kindLabel })}
        aria-pressed={true}
        title={t('favorites.unfavorite', { title: kindLabel })}
        style={{
          flex: 'none',
          width: 44,
          borderRadius: 6,
          border: '1px solid var(--ui-modal-btn-border)',
          background: 'var(--ui-modal-btn-bg)',
          color: '#e5484d',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Heart size={20} fill="#e5484d" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function FavoritesModal({ open, onClose }) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const scrollRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);
  const favorites = useFavoritesStore((s) => s.favorites);
  const loaded = useFavoritesStore((s) => s.loaded);
  const refreshing = useFavoritesStore((s) => s.refreshing);
  const dealFavorite = useGameStore((s) => s.dealFavorite);
  const [pendingUnfavorite, setPendingUnfavorite] = useState(null);
  const [pendingPlay, setPendingPlay] = useState(null);
  const [scrollMetrics, setScrollMetrics] = useState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });

  useModalEscape({ open, onClose, id: 'favorites', z: Z.CHILD });

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
  }, [open]);

  // Converge with the server on open (background: cached rows stay visible)
  // and whenever the outbox drains (a favorite/unfavorite just flushed, or
  // another device's change arrived via tab-return flush).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    useFavoritesStore.getState().refresh().catch(() => {});
    const onFlushed = () => {
      if (!cancelled) useFavoritesStore.getState().refresh().catch(() => {});
    };
    window.addEventListener('sync-flushed', onFlushed);
    return () => {
      cancelled = true;
      window.removeEventListener('sync-flushed', onFlushed);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setScrollMetrics({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
      return undefined;
    }

    const scrollElement = scrollRef.current;
    if (!scrollElement) return undefined;

    const updateScrollMetrics = () => {
      setScrollMetrics({
        scrollTop: scrollElement.scrollTop,
        scrollHeight: scrollElement.scrollHeight,
        clientHeight: scrollElement.clientHeight,
      });
    };

    scrollElement.addEventListener('scroll', updateScrollMetrics, { passive: true });
    window.addEventListener('resize', updateScrollMetrics);
    updateScrollMetrics();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateScrollMetrics)
      : null;
    resizeObserver?.observe(scrollElement);

    return () => {
      scrollElement.removeEventListener('scroll', updateScrollMetrics);
      window.removeEventListener('resize', updateScrollMetrics);
      resizeObserver?.disconnect();
    };
  }, [open, loaded, refreshing, favorites]);

  // Same gate as every New-Game entry point: an in-progress game is stashed
  // behind the "discard current game?" confirmation (which records a loss
  // on confirm). Otherwise a "play this favorite?" confirmation names the
  // deal first — the favorite only deals after an explicit Play.
  const playFavorite = useCallback((entry) => {
    if (useStatsStore.getState().isInProgress()) {
      useUiStore.getState().setPendingStartDeal(() => {
        onClose();
        useUiStore.getState().setSettingsDialogOpen(false);
        dealFavorite(entry);
      });
      useUiStore.getState().setConfirmNewGameDialogOpen(true);
      onClose();
    } else {
      setPendingPlay(entry);
    }
  }, [onClose, dealFavorite]);

  const confirmPlay = useCallback(() => {
    const entry = pendingPlay;
    setPendingPlay(null);
    if (!entry) return;
    const action = () => {
      onClose();
      useUiStore.getState().setSettingsDialogOpen(false);
      dealFavorite(entry);
    };
    // Defensive: if a game somehow started while the confirm was up, fall
    // back to the discard-confirmation gate instead of dealing over it.
    if (useStatsStore.getState().isInProgress()) {
      useUiStore.getState().setPendingStartDeal(action);
      useUiStore.getState().setConfirmNewGameDialogOpen(true);
      onClose();
    } else {
      action();
    }
  }, [pendingPlay, onClose, dealFavorite]);

  const confirmUnfavorite = useCallback(async () => {
    const entry = pendingUnfavorite;
    setPendingUnfavorite(null);
    if (!entry) return;
    try {
      await useFavoritesStore.getState().unfavorite(entry.seed);
    } catch {}
  }, [pendingUnfavorite]);

  if (!open) return null;

  const showColdLoading = !loaded && favorites.length === 0;

  const panel = {
    position: 'relative',
    background: 'var(--ui-modal-panel-bg)',
    color: 'var(--ui-modal-panel-fg)',
    border: 'var(--ui-modal-panel-border)',
    borderRadius: 'var(--ui-modal-panel-radius)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '20px 22px',
    width: 'min(90vw, 420px)',
    maxWidth: '100%',
    height: '85vh',
    display: 'flex',
    flexDirection: 'column',
  };
  const showScrollUp = scrollMetrics.scrollTop > 0;
  const showScrollDown =
    scrollMetrics.scrollTop + scrollMetrics.clientHeight < scrollMetrics.scrollHeight - 1;
  const scrollButton = {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 34,
    height: 28,
    display: 'grid',
    placeItems: 'center',
    padding: 0,
    border: '1px solid var(--ui-modal-panel-border)',
    borderRadius: 999,
    background: 'color-mix(in srgb, var(--ui-modal-panel-bg) 82%, transparent)',
    color: 'var(--ui-modal-panel-fg)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
    backdropFilter: 'blur(4px)',
    cursor: 'pointer',
    zIndex: 1,
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('favorites.title')}
        tabIndex={-1}
        ref={dialogRef}
        {...backdrop}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 3100,
          padding: 16,
        }}
      >
        <div style={panel}>
          <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>{t('favorites.title')}</h2>
          <ModalCloseButton onClick={onClose} />

          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
            <div ref={scrollRef} className="modal-body-scroll" style={{ height: '100%' }}>
              {showColdLoading ? (
                <div style={{ opacity: 0.8, fontSize: 14, marginBottom: 16 }}>{t('favorites.loading')}</div>
              ) : favorites.length === 0 ? (
                <div style={{ opacity: 0.8, fontSize: 14, marginBottom: 16 }}>{t('favorites.empty')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
                  {favorites.map((entry) => (
                    <FavoriteRow
                      key={entry.seed}
                      entry={entry}
                      onPlay={playFavorite}
                      onUnfavorite={setPendingUnfavorite}
                    />
                  ))}
                </div>
              )}
            </div>

            {showScrollUp && (
              <button
                type="button"
                aria-label={t('favorites.scrollTop')}
                onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                style={{ ...scrollButton, top: 8 }}
              >
                <ChevronUp size={18} strokeWidth={2.5} aria-hidden="true" />
              </button>
            )}
            {showScrollDown && (
              <button
                type="button"
                aria-label={t('favorites.scrollBottom')}
                onClick={() => {
                  const element = scrollRef.current;
                  element?.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
                }}
                style={{ ...scrollButton, bottom: 8 }}
              >
                <ChevronDown size={18} strokeWidth={2.5} aria-hidden="true" />
              </button>
            )}
          </div>

          <div
            aria-live="polite"
            style={{
              marginTop: 12,
              paddingTop: 10,
              borderTop: '1px solid var(--ui-modal-panel-border)',
              fontSize: 13,
              opacity: 0.8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span>{t('favorites.total', { count: favorites.length })}</span>
            {refreshing && <span>{t('favorites.refreshing')}</span>}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={pendingUnfavorite != null}
        title={t('favorites.unfavoriteTitle')}
        message={t('favorites.unfavoriteMessage')}
        confirmText={t('favorites.unfavoriteConfirm')}
        cancelText={t('favorites.unfavoriteCancel')}
        onConfirm={confirmUnfavorite}
        onCancel={() => setPendingUnfavorite(null)}
        zIndex={3200}
        z={Z.GRANDCHILD}
      />

      <ConfirmModal
        open={pendingPlay != null}
        title={t('favorites.playTitle')}
        message={pendingPlay ? t('favorites.playMessage', { title: eventDealTitle(pendingPlay, t) }) : ''}
        confirmText={t('favorites.playConfirm')}
        onConfirm={confirmPlay}
        onCancel={() => setPendingPlay(null)}
        zIndex={3200}
        z={Z.GRANDCHILD}
      />
    </>
  );
}
