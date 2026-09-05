// components/HistoryModal.jsx
// Game-history list (Main Menu > History). Supabase's game_results table is
// the authority, read newest-first in keyset pages; locally queued (not yet
// flushed) submit_game_result ops render as "pending" rows on top and dedupe
// away by game_id once flushed (see repo/gameHistoryRepository.js). Event-kind
// rows resolve their event title by seed, batched per page. Rows open
// HistoryDetailModal on top (Z.GRANDCHILD). Scroll chrome (metrics effect +
// up/down pills) mirrors AchievementsModal.jsx. Reached only from Settings.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useModalBackdrop } from './modalBackdrop.js';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import HistoryDetailModal from './HistoryDetailModal.jsx';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { formatTime } from '../utils/formatTime.js';
import {
  HISTORY_PAGE_SIZE,
  fetchHistoryPage,
  listPendingResultOps,
  mergeHistoryEntries,
  resolveEventTitles,
} from '../repo/gameHistoryRepository.js';

function HistoryRow({ entry, onOpen }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const active = hover || focus;

  const kindLabel = entry.eventTitle
    ?? (entry.gameKind ? t(`history.kinds.${entry.gameKind}`, { defaultValue: entry.gameKind }) : t('history.kinds.unknown'));

  const dateLabel = (() => {
    const d = new Date(entry.createdAt);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString();
  })();

  const meta = [
    dateLabel,
    entry.moves != null ? t('history.row.moves', { count: entry.moves }) : null,
    entry.durationMs != null ? formatTime(entry.durationMs) : null,
  ].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      onClick={() => onOpen(entry)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      aria-label={`${kindLabel} — ${entry.won ? t('history.won') : t('history.lost')} — ${meta}`}
      style={{
        width: '100%',
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
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {kindLabel}
        </span>
        {entry.pending && (
          <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1, borderRadius: 4, padding: '2px 5px', background: 'var(--ui-modal-btn-bg-strong)', whiteSpace: 'nowrap' }}>
            {t('history.pending')}
          </span>
        )}
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1,
            color: '#fff',
            background: entry.won ? 'var(--history-won-bg, #2e7d32)' : 'var(--history-lost-bg, #757575)',
            borderRadius: 4,
            padding: '2px 5px',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.won ? t('history.won') : t('history.lost')}
        </span>
      </span>
      {meta && (
        <span style={{ display: 'block', fontSize: 12, opacity: 0.75, marginTop: 4 }}>
          {meta}
        </span>
      )}
    </button>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function HistoryModal({ open, onClose }) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const scrollRef = useRef(null);
  const backdrop = useModalBackdrop(onClose);
  const userId = useAuthStore((s) => s.userId);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [offline, setOffline] = useState(false);
  const [selected, setSelected] = useState(null);
  const [scrollMetrics, setScrollMetrics] = useState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });

  useModalEscape({ open, onClose, id: 'history', z: Z.CHILD });

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
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
  }, [open, loading, loadingMore, entries]);

  const loadFirstPage = useCallback(async (cancelledRef) => {
    setLoading(true);
    setOffline(false);
    setEntries([]);
    setNextCursor(null);
    try {
      const [pendingOps, page] = await Promise.all([
        listPendingResultOps(),
        fetchHistoryPage({ limit: HISTORY_PAGE_SIZE }),
      ]);
      if (cancelledRef.current) return;
      const merged = mergeHistoryEntries(page.entries, pendingOps);
      await resolveEventTitles(merged);
      if (cancelledRef.current) return;
      setEntries(merged);
      setNextCursor(page.nextCursor);
    } catch {
      if (cancelledRef.current) return;
      // Offline / unauthenticated: fall back to pending rows only, if any.
      const pendingOps = await listPendingResultOps();
      if (cancelledRef.current) return;
      const merged = mergeHistoryEntries([], pendingOps);
      await resolveEventTitles(merged);
      if (cancelledRef.current) return;
      setEntries(merged);
      setOffline(merged.length === 0);
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const cancelledRef = { current: false };
    loadFirstPage(cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
  }, [open, userId, loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchHistoryPage({ ...nextCursor, limit: HISTORY_PAGE_SIZE });
      const withTitles = [...page.entries];
      await resolveEventTitles(withTitles);
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.key));
        return [...prev, ...withTitles.filter((e) => !seen.has(e.key))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      // Keep existing rows; the button stays so the user can retry.
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  if (!open) return null;

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
        aria-label={t('history.title')}
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
          <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, paddingRight: 36 }}>{t('history.title')}</h2>
          <ModalCloseButton onClick={onClose} />

          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
            <div ref={scrollRef} className="modal-body-scroll" style={{ height: '100%' }}>
              {loading ? (
                <div style={{ opacity: 0.8, fontSize: 14, marginBottom: 16 }}>{t('history.loading')}</div>
              ) : offline ? (
                <div style={{ opacity: 0.8, fontSize: 14, marginBottom: 16 }}>{t('history.offline')}</div>
              ) : entries.length === 0 ? (
                <div style={{ opacity: 0.8, fontSize: 14, marginBottom: 16 }}>{t('history.empty')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
                  {entries.map((entry) => (
                    <HistoryRow key={entry.key} entry={entry} onOpen={setSelected} />
                  ))}
                  {nextCursor && (
                    <button
                      type="button"
                      disabled={loadingMore}
                      onClick={loadMore}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        borderRadius: 6,
                        border: '1px solid var(--ui-modal-btn-border)',
                        background: 'var(--ui-modal-btn-bg)',
                        color: 'var(--ui-modal-fg)',
                        cursor: loadingMore ? 'not-allowed' : 'pointer',
                        fontSize: 14,
                        fontWeight: 600,
                      }}
                    >
                      {loadingMore ? t('history.loadingMore') : t('history.loadMore')}
                    </button>
                  )}
                </div>
              )}
            </div>

            {showScrollUp && (
              <button
                type="button"
                aria-label={t('history.scrollTop')}
                onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                style={{ ...scrollButton, top: 8 }}
              >
                <ChevronUp size={18} strokeWidth={2.5} aria-hidden="true" />
              </button>
            )}
            {showScrollDown && (
              <button
                type="button"
                aria-label={t('history.scrollBottom')}
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
        </div>
      </div>

      <HistoryDetailModal
        entry={selected}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
