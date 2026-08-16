// components/Toolbar.jsx
// New game, undo, theme/deck switchers. Stubs OK for switchers this pass.

import pkg from '../../package.json';
import { Plus, Undo2, Settings } from 'lucide-react';
import { useGameStore } from '../hooks/useGameStore.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useSound } from '../hooks/useSound.js';
import { isWon } from '../core/winDetection.js';
import ConfirmModal from './ConfirmModal.jsx';
import NewGameModal from './NewGameModal.jsx';
import SettingsModal from './SettingsModal.jsx';

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
  const settingsDialogOpen = useUiStore((s) => s.settingsDialogOpen);
  const setSettingsDialogOpen = useUiStore((s) => s.setSettingsDialogOpen);

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

  // Bottom-left cluster: [Settings] [New Game]. The Settings button sits to the
  // left of New Game; both are fixed-bottom and ~40px wide with a 12px gap.
  const FAB_WIDTH = 40;
  const FAB_GAP = 12;

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
        <span
          style={{
            color: '#fff',
            fontSize: 13,
            marginLeft: 'auto',
            userSelect: 'none',
          }}
        >
          v{pkg.version}
        </span>
      </div>

      <button
        style={{ ...fab, left: 16 }}
        aria-label="Settings"
        onClick={() => setSettingsDialogOpen(true)}
      >
        <Settings size={20} />
      </button>

      <button
        style={{ ...fab, left: 16 + FAB_WIDTH + FAB_GAP }}
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

      <SettingsModal
        open={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
        theme={theme}
        onThemeChange={onThemeChange}
        deck={deck}
        onDeckChange={onDeckChange}
        handedness={handedness}
        onHandednessChange={onHandednessChange}
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
