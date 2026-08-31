import { useEffect, useState } from 'react';
import { useModalBackdrop } from './modalBackdrop.js';
import ModalCloseButton from './ModalCloseButton.jsx';
import { useModalEscape } from '../hooks/useModalEscape.js';
import { Z } from '../utils/modalStack.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { getEvents } from '../repo/seedRepository.js';
import { eventImageUrl, onEventImageError } from '../utils/eventImage.js';
import { getAllEventProgress, revealedCount } from '../db/eventProgress.js';

export default function SpecialEventsModal() {
  const open = useUiStore((s) => s.specialEventsOpen);
  const setOpen = useUiStore((s) => s.setSpecialEventsOpen);
  const setDetail = useUiStore((s) => s.setEventDetailOpen);

  const backdrop = useModalBackdrop(() => setOpen(false));
  useModalEscape({ open, onClose: () => setOpen(false), id: 'events', z: Z.CHILD });

  const [events, setEvents] = useState([]);
  const [progress, setProgress] = useState({});

  useEffect(() => {
    if (!open) return;
    getEvents().then(setEvents).catch(() => setEvents([]));
    getAllEventProgress().then(setProgress).catch(() => setProgress({}));
  }, [open]);

  if (!open) return null;

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
    <div role="dialog" aria-modal="true" aria-label="Special Events" {...backdrop} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3100, padding: 16 }}>
      <div style={panel}>
        <h2 style={{ margin: '0 0 14px', fontSize: 20, fontWeight: 800, textAlign: 'center', paddingRight: 36 }}>Special Events</h2>
        <ModalCloseButton onClick={() => setOpen(false)} />
        {events.length === 0 ? (
          <p style={{ textAlign: 'center', opacity: 0.7, padding: '24px 0' }}>No events available yet. Check back soon!</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
            {events.map((ev) => {
              const prog = progress[ev.id];
              const wins = prog ? prog.wins : 0;
              const total = ev.seeds.length;
              const revealed = revealedCount(wins, total);
              const cover = ev.images[0];
              return (
                <button key={ev.id} type="button" onClick={() => { setDetail(ev.id); setOpen(false); }} style={{ textAlign: 'left', border: '1px solid var(--ui-modal-btn-border)', borderRadius: 10, overflow: 'hidden', background: 'var(--ui-modal-btn-bg)', cursor: 'pointer', padding: 0 }}>
                  <div style={{ height: 120, background: 'var(--ui-control-bg)', overflow: 'hidden', position: 'relative' }}>
                    {cover ? (
                      <img src={eventImageUrl(cover)} alt="" onError={onEventImageError} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: wins === 0 ? 'blur(12px) brightness(0.6)' : revealed === 0 ? 'blur(8px)' : 'none', transition: 'filter 0.3s' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, fontSize: 12 }}>No image</div>
                    )}
                    <div style={{ position: 'absolute', bottom: 6, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 10 }}>{wins}/{total}</div>
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.title}</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{revealed}/{ev.images.length} images revealed</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
