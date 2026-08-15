// components/Toolbar.jsx
// New game, undo, theme/deck switchers. Stubs OK for switchers this pass.

import { useState } from 'react';
import pkg from '../../package.json';
import { useGameStore } from '../hooks/useGameStore.js';
import { useSound } from '../hooks/useSound.js';
import { isWon } from '../core/winDetection.js';
import ConfirmModal from './ConfirmModal.jsx';

/**
 * @param {object} props
 * @param {string} props.theme    active theme name
 * @param {(t: string) => void} props.onThemeChange
 * @param {string} props.deck     active deck/renderer name
 * @param {(d: string) => void} props.onDeckChange
 */
export default function Toolbar({ theme, onThemeChange, deck, onDeckChange }) {
  const [confirmNewGame, setConfirmNewGame] = useState(false);
  const dealNewGame = useGameStore((s) => s.dealNewGame);
  const undo = useGameStore((s) => s.undo);
  const redo = useGameStore((s) => s.redo);
  const canUndo = useGameStore((s) => s.state.moveHistory.length > 0);
  const canRedo = useGameStore((s) => s.redoStack.length > 0);
  const won = useGameStore((s) => isWon(s.state));
  const { play } = useSound();

  const btn = {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.25)',
    background: 'rgba(255,255,255,0.1)',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 13,
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
        padding: '8px clamp(8px, 2vw, 20px)',
      }}
    >
      <button style={btn} onClick={() => setConfirmNewGame(true)}>
        New Game
      </button>
      <button
        style={{ ...btn, opacity: won || !canUndo ? 0.4 : 1 }}
        disabled={won || !canUndo}
        onClick={undo}
      >
        Undo
      </button>
      <button
        style={{ ...btn, opacity: won || !canRedo ? 0.4 : 1 }}
        disabled={won || !canRedo}
        onClick={redo}
      >
        Redo
      </button>

      <label style={{ color: '#fff', fontSize: 13 }}>
        Theme{' '}
        <select value={theme} onChange={(e) => onThemeChange(e.target.value)} style={{ ...btn }}>
          <option value="classic">Classic</option>
          <option value="dark">Dark</option>
          {/* TODO(next pass): register more themes */}
        </select>
      </label>

      <label style={{ color: '#fff', fontSize: 13 }}>
        Deck{' '}
        <select value={deck} onChange={(e) => onDeckChange(e.target.value)} style={{ ...btn }}>
          <option value="procedural">Procedural</option>
          <option value="sprite">Sprite (atlas)</option>
          {/* TODO(next pass): add real deck renderers */}
        </select>
      </label>

      <span
        style={{
          color: '#fff',
          fontSize: 13,
          marginLeft: 'auto',
          userSelect: 'none',
        }}
      >
        Version v{pkg.version}
      </span>

      <ConfirmModal
        open={confirmNewGame}
        title="New Game"
        message="Start a new game? Current progress will be lost."
        confirmText="New Game"
        onConfirm={() => {
          setConfirmNewGame(false);
          dealNewGame();
          play('deal');
        }}
        onCancel={() => setConfirmNewGame(false)}
      />
    </div>
  );
}
