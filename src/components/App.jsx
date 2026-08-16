// components/App.jsx
// Root component. Composes Toolbar + Board. Loads the classic theme CSS.

import '../render/themes/classic.css';
import '../render/themes/dark.css';
// Side-effect imports register the deck renderers with the registry.
import '../render/deck/SpriteDeckRenderer.js';
import '../render/deck/ProceduralDeckRenderer.js';
import { useEffect } from 'react';
import Toolbar from './Toolbar.jsx';
import Board from './Board.jsx';
import { useGameStore } from '../hooks/useGameStore.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';
import { isWon } from '../core/winDetection.js';
import { MotionDebugPanel } from '../render/animation/MotionDebugPanel.jsx';

export default function App() {
  const theme = useSettingsStore((s) => s.theme);
  const deck = useSettingsStore((s) => s.deck);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setDeck = useSettingsStore((s) => s.setDeck);
  const init = useSettingsStore((s) => s.init);
  const state = useGameStore((s) => s.state);
  const won = isWon(state);

  useEffect(() => {
    init();
  }, [init]);

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
      />
      <Board />
      {import.meta.env.DEV && <MotionDebugPanel />}
      {won && (
        <div style={{ textAlign: 'center', color: '#fff', fontWeight: 700, padding: 12 }}>
          You won! 🎉
        </div>
      )}
    </div>
  );
}
