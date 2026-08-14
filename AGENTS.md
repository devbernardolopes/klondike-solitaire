# AGENTS.md — Klondike Solitaire

Scaffolding pass. This is a **skeleton**: architecture, folder structure, core data
model, and stub implementations with clear TODOs. Not a finished game.

## Stack

- Vite + React 18 (JavaScript, **not** TypeScript)
- Tailwind CSS v4 (`@tailwindcss/vite` plugin)
- Zustand for state
- `@dnd-kit/core` + `@dnd-kit/sortable` for drag-and-drop
- Dexie.js for persistence
- Howler.js (stub) and GSAP (stub) — not yet wired

## CRITICAL architectural rule: `core/` is framework-agnostic

Everything under `src/core/` is plain JS with **zero** imports from React, the DOM,
or any UI library. It must be runnable standalone (Node test script) and unit-testable
in isolation. UI components read from and dispatch to this core **via the Zustand store**;
they never implement game rules themselves.

Modules in `src/core/`:

- `Card.js` — `createCard(suit, rank, {faceUp, id})`, `colorOf`, `SUITS`, `RANKS`. Stable unique `id`.
- `Deck.js` — `buildStandardDeck()`, `shuffle(deck, seed?)` (seeded = deterministic Mulberry32).
- `GameState.js` — JSDoc typedef of the full `GameState` shape + `createEmptyGameState()`.
- `rules.js` — **REAL logic** (tableau down alternating color, foundation up by suit from Ace, `isValidSequence`).
- `moveEngine.js` — **PURE** `applyMove(state, move) -> newState` (never mutates input), `undo(state)`, `redo(state, record)`.
- `dealer.js` — `deal({seed?}) -> GameState` (standard Klondike layout).
- `winDetection.js` — `isWon(state)`.

## Deck renderer interface contract

Implemented by any renderer registered in `src/render/deck/deckRegistry.js`.
Every renderer MUST provide:

- `renderCard(suit, rank) -> string`  (data URL or CSS background value)
- `renderBack() -> string`
- `dispose() -> void` (optional)

`CardView.jsx` will consume the active renderer's output as a background-image. The two
current renderers (`SpriteDeckRenderer`, `ProceduralDeckRenderer`) are **stubs**: their
methods `throw` "not implemented" so accidental use surfaces immediately. They exist only
to lock the interface. `CardView` currently renders a plain text placeholder instead.

## Move / pile locator format

`"<kind>:<index>"` where kind ∈ `stock | waste | foundation | tableau`. `stock`/`waste`
take no index. `foundation:0..3`, `tableau:0..6`.

## Zustand store (`src/hooks/useGameStore.js`)

Exposes `state` (raw core GameState), `dealNewGame(seed?)`, `drawFromStock()`,
`recycleStock()`, `moveCard(from, to, cardId?)`, `undo()`, `redo()`, plus `isWon()`,
`canUndo`, `canRedo`. `moveCard` validates via `core/rules.js` and ignores illegal moves.
A `redoStack` holds undone records so `redo()` can replay them.

## Drag engine (`src/hooks/useDragEngine.js`)

Thin `@dnd-kit` wrapper: `DndContext` + `PointerSensor`/`KeyboardSensor`. Card draggables
carry `{ from, cardId }`; pile droppables carry `{ loc }`. On drop, calls `moveCard`.
**Single top-card moves only** this pass.

## What is IMPLEMENTED vs STUBBED (this pass)

### Implemented

- Full `core/` rules + pure move engine + deal + win detection (real, usable).
- Project scaffolding: `package.json`, Vite, Tailwind v4, `index.html`, `main.jsx`.
- `Board.jsx` responsive CSS-grid layout (stock/waste/foundations top row, 7 tableau columns)
  with correct initial deal (face-down + face-up). Cards are plain text-colored divs.
- Single top-card drag-and-drop between valid piles via `rules.js`.
- Store: deal / draw / recycle / move / undo / redo.
- Dexie schema, sound manager, leaderboard client (functional but local/mock).

### Stubbed (marked with TODO)

- `SpriteDeckRenderer` / `ProceduralDeckRenderer` — interface locked, methods throw.
- `CardView` card art — text placeholder; renderer not yet consumed.
- `audio/soundManager.js` — `play()` logs to console; no Howler playback, no sound files.
- `useSound.js` — `enabled` always true; no settings wiring; mute toggle is a no-op.
- `api/leaderboard.js` — localStorage mock; no real backend.
- `GSAP` animations — not imported anywhere yet.
- Only one theme CSS (`classic.css`); theme/deck `<select>`s are no-ops in `App.jsx`.
- **Multi-card tableau run dragging** — marked `// TODO: multi-card run dragging` in `useDragEngine.js`.
- **Keyboard navigation** — referenced TODO in `useDragEngine.js`; focus/tabindex not attached.

## Where the next pass picks up

1. Build the two deck renderers (atlas slicing / canvas drawing) and wire into `CardView`.
2. Multi-card run dragging (drag a valid descending-alternating sequence together).
3. Real Howler playback + sound files; settings-driven mute.
4. GSAP deal/flip/win animations.
5. Real leaderboard backend; persist games to Dexie on game-over.
6. Theme system + accessible keyboard controls.

## Run

```bash
npm install
npm run dev
```

## Commit Convention

When there are changes to commit, AI agents should suggest an one-line commit message at the end of their response following conventional commit format: `type(scope): description`. Use types like `feat`, `fix`, `refactor`, `docs`, `chore` and keep descriptions concise but descriptive — focus on the "why" rather than the "what".
