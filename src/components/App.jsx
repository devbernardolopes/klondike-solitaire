// components/App.jsx
// Root component. Composes Toolbar + Board. Loads the classic + dark theme
// CSS and registers both deck renderers (side-effect imports).

import '../render/themes/classic.css';
import '../render/themes/dark.css';
// Side-effect imports register the deck renderers with the registry.
import '../render/deck/SpriteDeckRenderer.js';
import '../render/deck/ProceduralDeckRenderer.js';
import { useEffect } from 'react';
import Toolbar from './Toolbar.jsx';
import Board from './Board.jsx';
import WinModal from './WinModal.jsx';
import { useGameStore } from '../hooks/useGameStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';
import { useStatisticsStore } from '../hooks/useStatisticsStore.js';
import { useSeedStore } from '../hooks/useSeedStore.js';
import { MotionDebugPanel } from '../render/animation/MotionDebugPanel.jsx';

export default function App() {
  const theme = useSettingsStore((s) => s.theme);
  const deck = useSettingsStore((s) => s.deck);
  const handedness = useSettingsStore((s) => s.handedness);
  const highlightCard = useSettingsStore((s) => s.highlightCard);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setDeck = useSettingsStore((s) => s.setDeck);
  const setHandedness = useSettingsStore((s) => s.setHandedness);
  const setHighlightCard = useSettingsStore((s) => s.setHighlightCard);
  const init = useSettingsStore((s) => s.init);
  const initStats = useStatisticsStore((s) => s.init);
  const initSeeds = useSeedStore((s) => s.init);
  const state = useGameStore((s) => s.state);

  useEffect(() => {
    init();
    initStats();
    initSeeds();
    useGameStore.getState().initialDeal();
  }, [init, initStats, initSeeds]);

  // Pause/resume the play timer with tab focus. When the tab is hidden the clock
  // freezes (hidden time excluded); when it returns the clock resumes. The auto-
  // complete animation likewise just freezes and resumes (rAF pause + GSAP lag
  // smoothing), so the game never silently jumps to a win while unfocused.
  useEffect(() => {
    const onVisibility = () => {
      useStatsStore.getState().setFocused(!document.hidden);
    };
    useStatsStore.getState().setFocused(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return (
    <div
      className={`theme-${theme}`}
      style={{
        minHeight: '100%',
        background: 'var(--felt-color)',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Toolbar
        theme={theme}
        onThemeChange={setTheme}
        deck={deck}
        onDeckChange={setDeck}
        handedness={handedness}
        onHandednessChange={setHandedness}
        highlightCard={highlightCard}
        onHighlightCardChange={setHighlightCard}
      />
      <Board />
      {import.meta.env.DEV && <MotionDebugPanel />}
      <WinModal />
    </div>
  );
}
