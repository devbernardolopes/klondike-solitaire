// components/App.jsx
// Root component. Composes Toolbar + Board. Loads the classic theme CSS.

import '../render/themes/classic.css';
import '../render/themes/dark.css';
// Side-effect imports register the deck renderers with the registry.
import '../render/deck/SpriteDeckRenderer.js';
import '../render/deck/ProceduralDeckRenderer.js';
import { useState } from 'react';
import Toolbar from './Toolbar.jsx';
import Board from './Board.jsx';
import { useGameStore } from '../hooks/useGameStore.js';
import { isWon } from '../core/winDetection.js';
import { MotionDebugPanel } from '../render/animation/MotionDebugPanel.jsx';

export default function App() {
  const [theme, setTheme] = useState('classic');
  const [deck] = useState('procedural');
  // TODO(next pass): wire theme/deck selection into the settings store + renderer.
  const state = useGameStore((s) => s.state);
  const won = isWon(state);

  return (
    <div
      className={`theme-${theme}`}
      style={{
        minHeight: '100%',
        background: 'var(--felt-color)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Toolbar
        theme={theme}
        onThemeChange={setTheme}
        deck={deck}
        onDeckChange={() => {}}
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
