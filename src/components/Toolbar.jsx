// components/Toolbar.jsx
// New game, undo, theme/deck switchers. Stubs OK for switchers this pass.

import pkg from '../../package.json';
import { Plus, Undo2 } from 'lucide-react';
import { useGameStore } from '../hooks/useGameStore.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useSound } from '../hooks/useSound.js';
import { isWon } from '../core/winDetection.js';
import ConfirmModal from './ConfirmModal.jsx';
import NewGameModal from './NewGameModal.jsx';

/**
 * @param {object} props
 * @param {string} props.theme    active theme name
 * @param {(t: string) => void} props.onThemeChange
 * @param {string} props.deck     active deck/renderer name
 * @param {(d: string) => void} props.onDeckChange
 * @param {'left'|'right'} props.handedness  board pile arrangement
 * @param {(h: 'left'|'right') => void} props.onHandednessChange
 */
export default function Toolbar({ theme, onThemeChange, deck, onDeckChange, handedness, onHandednessChange }) {
  const dealNewGame = useGameStore((s) => s.dealNewGame);
  const undo = useGameStore((s) => s.undo);
  const canUndo = useGameStore((s) => s.state.moveHistory.length > 0);
  const won = useGameStore((s) => isWon(s.state));
  const { play } = useSound();

  const newGameDialogOpen = useUiStore((s) => s.newGameDialogOpen);
  const setNewGameDialogOpen = useUiStore((s) => s.setNewGameDialogOpen);
  const lastNewGameMode = useUiStore((s) => s.lastNewGameMode);
  const noMovesDialogOpen = useUiStore((s) => s.noMovesDialogOpen);
  const setNoMovesDialogOpen = useUiStore((s) => s.setNoMovesDialogOpen);

  const btn = {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.25)',
    background: 'rgba(255,255,255,0.1)',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 13,
  };

  // Floating action-button styling shared by the bottom-corner controls.
  const fab = {
    ...btn,
    position: 'fixed',
    bottom: 16,
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  };

  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: '8px clamp(8px, 2vw, 20px)',
        }}
      >
        <label style={{ color: '#fff', fontSize: 13 }}>
          Theme{' '}
          <select value={theme} onChange={(e) => onThemeChange(e.target.value)} style={{ ...btn, color: 'var(--ui-control-fg)', background: 'var(--ui-control-bg)', border: '1px solid var(--ui-control-border)' }}>
            <option value="classic">Classic</option>
            <option value="dark">Dark</option>
            {/* TODO(next pass): register more themes */}
          </select>
        </label>

        <label style={{ color: '#fff', fontSize: 13 }}>
          Deck{' '}
          <select value={deck} onChange={(e) => onDeckChange(e.target.value)} style={{ ...btn, color: 'var(--ui-control-fg)', background: 'var(--ui-control-bg)', border: '1px solid var(--ui-control-border)' }}>
            <option value="procedural">Procedural</option>
            <option value="sprite">Sprite (atlas)</option>
            {/* TODO(next pass): add real deck renderers */}
          </select>
        </label>

        <label style={{ color: '#fff', fontSize: 13 }}>
          Hand{' '}
          <select value={handedness} onChange={(e) => onHandednessChange(e.target.value)} style={{ ...btn, color: 'var(--ui-control-fg)', background: 'var(--ui-control-bg)', border: '1px solid var(--ui-control-border)' }}>
            <option value="left">Left</option>
            <option value="right">Right</option>
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
      </div>

      <button
        style={{ ...fab, left: 16 }}
        aria-label="New Game"
        onClick={() => setNewGameDialogOpen(true)}
      >
        <Plus size={20} />
      </button>

      <button
        style={{ ...fab, right: 16, opacity: won || !canUndo ? 0.4 : 1 }}
        aria-label="Undo"
        disabled={won || !canUndo}
        onClick={undo}
      >
        <Undo2 size={20} />
      </button>

      <NewGameModal
        open={newGameDialogOpen}
        onWinningDeal={() => {
          setNewGameDialogOpen(false);
          dealNewGame('winning');
          play('deal');
        }}
        onRandomShuffle={() => {
          setNewGameDialogOpen(false);
          dealNewGame('random');
          play('deal');
        }}
        onDismiss={() => setNewGameDialogOpen(false)}
      />

      <ConfirmModal
        open={noMovesDialogOpen}
        title="No moves remaining"
        message="There don't seem to be any more valid moves. You can undo your last move or start a new game."
        confirmText="New Game"
        cancelText="Undo Last Move"
        onConfirm={() => {
          setNoMovesDialogOpen(false);
          dealNewGame(lastNewGameMode);
        }}
        onCancel={() => {
          setNoMovesDialogOpen(false);
          undo();
        }}
      />
    </>
  );
}
