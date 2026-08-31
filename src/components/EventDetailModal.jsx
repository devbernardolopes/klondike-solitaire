import { useEffect, useState } from 'react';
import { useModalBackdrop } from './modalBackdrop.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useGameStore } from '../hooks/useGameStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { getEvents } from '../repo/seedRepository.js';
import { getEvent } from '../core/specialEvents.js';
import { eventImageUrl, onEventImageError } from '../utils/eventImage.js';
import { getEventProgress, revealedCount, revealThresholds } from '../db/eventProgress.js';

export default function EventDetailModal() {
  const eventId = useUiStore((s) => s.eventDetailId);
  const open = eventId != null;
  const setEventDetail = useUiStore((s) => s.setEventDetailOpen);
  const setEventsOpen = useUiStore((s) => s.setSpecialEventsOpen);
  const dealEvent = useGameStore((s) => s.dealEvent);

  const backdrop = useModalBackdrop(() => setEventDetail(null));
  useModalEscape({ open, onClose: () => setEventDetail(null), id: 'event-detail', z: Z.CHILD });

  const [event, setEvent] = useState(null);
  const [progress, setProgress] = useState({ wins: 0, wonSeeds: [] });

  useEffect(() => {
    if (!open) return;
    getEvents().then((evs) => setEvent(getEvent(eventId, evs))).catch(() => setEvent(null));
    getEventProgress(eventId).then(setProgress).catch(() => setProgress({ wins: 0, wonSeeds: [] }));
  }, [open, eventId]);

  if (!open || !event) return null;

  const total = event.seeds.length;
  const wins = progress.wins;
  const thresholds = revealThresholds(total);
  const revealed = revealedCount(wins, total);

  const onPlay = (idx) => {
    const run = async () => {
      const ok = await dealEvent(event.id, idx);
      if (ok) setEventDetail(null);
    };
    if (useStatsStore.getState().isInProgress()) {
      useUiStore.getState().setPendingStartDeal(run);
      useUiStore.getState().setConfirmNewGameDialogOpen(true);
    } else {
      run();
    }
  };

  const onBack = () => {
    setEventDetail(null);
    setEventsOpen(true);
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
    maxHeight: '85vh',
    overflowY: 'auto',
    outline: 'none',
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={event.title} {...backdrop} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3100, padding: 16 }}>
      <div style={panel}>
        <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, paddingRight: 36 }}>{event.title}</h2>
        {event.description && <p style={{ margin: '0 0 14px', fontSize: 13, opacity: 0.8 }}>{event.description}</p>}
        <ModalCloseButton onClick={() => setEventDetail(null)} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {event.images.map((img, i) => {
            const isRevealed = i < revealed;
            return (
              <div key={i} style={{ flex: '1 1 140px', height: 120, borderRadius: 8, overflow: 'hidden', background: 'var(--ui-control-bg)', position: 'relative', border: '1px solid var(--ui-modal-btn-border)' }}>
                <img src={eventImageUrl(img)} alt={`${event.title} ${i + 1}`} onError={onEventImageError} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: isRevealed ? 'none' : 'blur(14px) brightness(0.5)', transition: 'filter 0.4s' }} />
                {!isRevealed && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700, background: 'rgba(0,0,0,0.3)' }}>Win {thresholds[i]} to reveal</div>}
              </div>
            );
          })}
          {event.images.length === 0 && <div style={{ fontSize: 13, opacity: 0.6 }}>No images for this event yet.</div>}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Progress: {wins}/{total} deals won</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 8, maxHeight: 220, overflowY: 'auto', padding: '4px 0' }}>
          {event.seeds.map((seed, idx) => {
            const won = progress.wonSeeds.includes(seed);
            return (
              <button key={seed} type="button" onClick={() => onPlay(idx)} style={{ padding: '8px 4px', borderRadius: 6, border: '1px solid var(--ui-modal-btn-border)', background: won ? 'var(--ui-modal-btn-bg-strong)' : 'var(--ui-modal-btn-bg)', color: 'var(--ui-modal-fg)', fontSize: 12, fontWeight: won ? 700 : 400, cursor: 'pointer', position: 'relative' }}>
                #{idx + 1}
                {won && <span style={{ position: 'absolute', top: -6, right: -6, background: '#2e7d32', color: '#fff', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>✓</span>}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
          <button type="button" onClick={onBack} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid var(--ui-modal-btn-border)', background: 'var(--ui-modal-btn-bg)', color: 'var(--ui-modal-fg)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Back</button>
          <button type="button" onClick={() => setEventDetail(null)} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid var(--ui-modal-btn-border)', background: 'var(--ui-modal-btn-bg)', color: 'var(--ui-modal-fg)', cursor: 'pointer', fontSize: 13 }}>Close</button>
        </div>
      </div>
    </div>
  );
}
