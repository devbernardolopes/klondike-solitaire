// components/PlaybackBar.jsx
// Transport controls for move playback, rendered just above the toolbar
// while a recorded deal is being replayed. Returns null when inactive.
//
//   |◀  ◀  ▶/⏸  ▶  ▶|  [1.00x]  3 / 42
//
// Back buttons disable at the first board, forward buttons at the last.
// Pressing a step button during Play applies that step and pauses. Play at
// the end restarts from the top. Speed cycles 0.75x → 1x → 1.25x → 2x.

import { useTranslation } from 'react-i18next';
import { SkipBack, ChevronLeft, ChevronRight, SkipForward, Play, Pause } from 'lucide-react';
import { usePlaybackStore } from '../hooks/usePlaybackStore.js';
import { useUiStore } from '../hooks/useUiStore.js';

const btn = {
  background: 'var(--ui-modal-panel-bg)',
  color: 'var(--ui-modal-panel-fg)',
  border: '1px solid var(--ui-modal-panel-border)',
  borderRadius: 8,
  width: 40,
  height: 40,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

const btnDisabled = { ...btn, opacity: 0.35, cursor: 'default' };

export default function PlaybackBar() {
  const { t } = useTranslation();
  const active = useUiStore((s) => s.playbackActive);
  const cursor = usePlaybackStore((s) => s.cursor);
  const total = usePlaybackStore((s) => s.states.length);
  const playing = usePlaybackStore((s) => s.playing);
  const speed = usePlaybackStore((s) => s.speed);

  if (!active || total === 0) return null;

  const atStart = cursor <= 0;
  const atEnd = cursor >= total - 1;

  return (
    <div
      role="toolbar"
      aria-label={t('playback.bar.label')}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '8px 12px',
        flexWrap: 'wrap',
      }}
    >
      <button
        type="button"
        style={atStart ? btnDisabled : btn}
        aria-label={t('playback.bar.backToStart')}
        title={t('playback.bar.backToStart')}
        disabled={atStart}
        onClick={() => usePlaybackStore.getState().stepTo(0)}
      >
        <SkipBack size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        style={atStart ? btnDisabled : btn}
        aria-label={t('playback.bar.backStep')}
        title={t('playback.bar.backStep')}
        disabled={atStart}
        onClick={() => usePlaybackStore.getState().stepBy(-1)}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        style={btn}
        aria-label={playing ? t('playback.bar.pause') : t('playback.bar.play')}
        title={playing ? t('playback.bar.pause') : t('playback.bar.play')}
        onClick={() => (playing ? usePlaybackStore.getState().pause() : usePlaybackStore.getState().play())}
      >
        {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
      </button>
      <button
        type="button"
        style={atEnd ? btnDisabled : btn}
        aria-label={t('playback.bar.forwardStep')}
        title={t('playback.bar.forwardStep')}
        disabled={atEnd}
        onClick={() => usePlaybackStore.getState().stepBy(1)}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        style={atEnd ? btnDisabled : btn}
        aria-label={t('playback.bar.forwardToEnd')}
        title={t('playback.bar.forwardToEnd')}
        disabled={atEnd}
        onClick={() => usePlaybackStore.getState().stepTo(total - 1)}
      >
        <SkipForward size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        style={{ ...btn, width: 'auto', padding: '0 10px', fontSize: 13, fontWeight: 700 }}
        aria-label={t('playback.bar.speed')}
        title={t('playback.bar.speed')}
        onClick={() => usePlaybackStore.getState().cycleSpeed()}
      >
        {`${speed.toFixed(2)}x`}
      </button>
    </div>
  );
}
