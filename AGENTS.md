# AGENTS.md — Klondike Solitaire

Live game (no longer a skeleton). Architecture, folder structure, framework-agnostic
`core/`, and the UI layers that consume it are all present and exercised. Some
integration edges are still stubbed (audio, scoring, the `games` history table,
leaderboards backend, and achievements). Supabase is integrated for anonymous auth
already; leaderboards + achievements are the current build-out phase.

Locally the project is here: `C:\Dev\klondike-solitaire\klondike-solitaire`.

## Stack

- Vite + React 18 (JavaScript, **not** TypeScript)
- Tailwind CSS v4 (`@tailwindcss/vite` plugin)
- Zustand for state (seven stores — see below)
- `@dnd-kit/core` + `@dnd-kit/sortable` for drag-and-drop
- Dexie.js for local persistence (settings/stats/played-seeds/daily results wired; `games` history table defined, `saveGame()` not yet called)
- `@supabase/supabase-js` — Supabase client wired for **anonymous auth** (`lib/supabaseClient.js` + `hooks/useAuthStore.js`); intended backend for leaderboards + achievements (not yet used there)
- Supabase schema + migrations live in `supabase/` (version-controlled; never bundled into `dist/`, so not exposed at Vercel). `klondike_supabase_schema.sql` is the base schema; `klondike_supabase_migration_00N.sql` are ordered upgrades; `submit_game_result*.sql` are DB functions. (`.other/` remains git-ignored for non-SQL scratch files.)
- Howler.js — **stub** (no playback yet; see Stubbed)
- GSAP — **wired** (Flip-based move/flip pipeline, win cascade, shake, foundation particle burst, dev debug panel)
- `leva` (dev motion debug panel) and `lucide-react` (toolbar icons) as extras
- `node --test` for unit tests; `husky` git hooks (`prepare` script)

## Configuration

`lib/supabaseClient.js` reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from
the environment. Copy `.env.example` to `.env` and fill them in (it errors loudly in
dev if missing). Supabase is offline-tolerant: a missing/empty config or a failed
network sign-in degrades to a ready-but-unauthenticated app that remains fully playable.

## Deployment + Manual QA

Solo-dev, fast-paced project. Every commit pushed to GitHub auto-deploys to Vercel (free tier).

Every deployment is manually tested on both devices below, always signed in with the
same Supabase Google/OAuth account (not Brave sync):

- Device A (desktop): Samsung Odyssey notebook, 1920x1080, Windows 10, Brave browser.
- Device B (mobile): Samsung Galaxy A03 in portrait mode, 360x800, Android 13, Brave browser.

Implications for agents: verify responsive layout at both 1920px desktop and 360px
portrait-mobile widths, cover mouse-drag and touch input paths, watch for Brave-specific
quirks, and consider cross-device behavior when touching auth-persisted state.

## CRITICAL architectural rule: `core/` is framework-agnostic

Everything under `src/core/` is plain JS with **zero** imports from React, the DOM,
or any UI library. It must be runnable standalone (Node test script) and unit-testable
in isolation. UI components read from and dispatch to this core **via the Zustand store**;
they never implement game rules themselves. Recent additions `dailyChallenge.js`,
`hints.js`, and `snapshot.js` all conform to this rule.

Modules in `src/core/`:

- `Card.js` — `createCard(suit, rank, {faceUp, id})`, `colorOf`, `SUITS`, `RANKS`. Stable unique `id`.
- `Deck.js` — `buildStandardDeck()`, `shuffle(deck, seed?)` (seeded = deterministic Mulberry32).
- `GameState.js` — JSDoc typedef of the full `GameState` shape + `createEmptyGameState()`.
- `rules.js` — **REAL logic** (tableau down alternating color, foundation up by suit from Ace,
  `isValidSequence`). Additional helpers used by the UI: `getTableauRun`, `getAutoMoveTargets`,
  `findFoundationMove`, `hasAnyValidMove`, `isObviousWinState`, `DEST_ORDER`.
- `solver.js` — **PURE** `findWinningSequence(state, {maxNodes, maxMs})` (memoized DFS proving a full win,
  modeling draw/recycle/foundation/tableau moves) and `isAutoCompletable(state)` (true when the
  tableau is fully revealed AND a win is provable). Also `hasDeadEndMove` (used by the timer to
  avoid starting the clock on a hopeless board). No DOM/worker imports — unit-testable in isolation.
- `solverClient.js` + `solver.worker.js` — `solverClient.js` wraps `findWinningSequence` in a Web Worker
  (`solver.worker.js`) via `solveAsync(state, opts) -> { promise, cancel }`, so the (potentially
  expensive) search runs **off the main thread** and never freezes the UI. Stale jobs are dropped via a
  generation counter bumped on `cancel()` / `cancelAllSolves()`.
- `moveEngine.js` — **PURE** `applyMove(state, move) -> newState` (never mutates input). Move
  `type`s: `draw`, `recycle`, `moveCards`. `undo(state)`, `redo(state, record)` (records carried in
  the store's `redoStack`).
- `dealer.js` — `deal({seed?}) -> GameState` (standard Klondike layout). When no seed is given,
  the store pulls a pre-verified **solvable** seed from `solvablePool.js`, excluding already-won seeds.
- `winDetection.js` — `isWon(state)`.
- `solvablePool.js` — `randomSolvableSeed()`; reads `data/solvableSeeds.json`. Generated by
  `scripts/generateSolvablePool.mjs`.
- `hints.js` — `findHints(state)` enumerates currently-visible legal moves for the hint affordance
  (waste top + face-up tableau cards, each possibly carrying a run), reusing `rules.getAutoMoveTargets`.
- `snapshot.js` — `buildSnapshotText(state)` renders the visible board to the plain-text snapshot
  format exported via Settings ("Take Snapshot"); face-down cards are `00`, stock is `00` placeholders.
- `dailyChallenge.js` — framework-agnostic daily-deal logic: `seedForDate`, `getSupportedRange`,
  calendar/range helpers (`addMonths`, `daysInMonth`, `withinSupported`, `isAfter`, etc.). Seeds are
  bundled in `data/dailyChallenge.json`; dates outside the window return null.
- `specialEvents.js` — framework-agnostic special-event deals: merges `data/eventCatalog.json`
  (curated titles/images) with `data/specialEvents.json` (generated seeds) by event id via
  `listEvents`, `getEvent`, `seedsForEvent`.

## Deck renderer interface contract

Implemented by renderers registered in `src/render/deck/deckRegistry.js`. Every renderer
MUST provide (the JSDoc `@typedef {DeckRenderer}` in `deckRegistry.js` is the source of truth):

- `renderCard(suit, rank) -> string`  (data URL or CSS background value)
- `renderBack() -> string`
- `dispose() -> void` (optional)

The registry also manages the **active** deck: `setActiveDeck(name)`,
`getActiveDeckName()`, `getDeck(name?)`, `listDecks()`. `useSettingsStore.setDeck`
activates a renderer so `CardView` can re-render faces from the right source.

Current renderers (both **implemented**, sharing drawing primitives in `drawCard.js`):

- `SpriteDeckRenderer` — builds a single atlas canvas of all 52 faces + back at startup,
  then slices per-card rects into data URLs (real atlas-slicing path).
- `ProceduralDeckRenderer` — draws each face/back onto its own offscreen canvas → data URL,
  cached per (suit, rank). This is the default active deck.

`CardView.jsx` consumes the active renderer's output as a background-image and renders both
faces inside a 3D `card-flip-container` (see `render/animation/useCardFaceFlip.js`) so face
flips animate. No text-only placeholder remains.

## Move / pile locator format

`"<kind>:<index>"` where kind ∈ `stock | waste | foundation | tableau`. `stock`/`waste`
take no index. `foundation:0..3`, `tableau:0..6`.

## Zustand stores

### `src/hooks/useGameStore.js` (game state + actions)

Exposes `state` (raw core GameState) plus actions:
`dealNewGame(mode?)`, `dealDaily(date)`, `initialDeal()`, `drawFromStock()`, `recycleStock()`,
`moveCard(from, to, cardId?, opts?)`, `undo()`, `redo()`, `autoMove(from, cardId)`,
`autoComplete(force?)`, `replayGame()`, `isWon()`, `canUndo()`, `canRedo()`. `mode` is
`'winning'` (solvable seed) or `'random'` (unseeded); `lastNewGameMode` records the mode for
the post-win "New Game" button.

`dealNewGame` draws a solvable seed from `solvablePool` but excludes seeds already present in
`useSeedStore.playedSeeds` (won Winning-Deal seeds). `dealDaily(date)` deals the bundled daily
seed; `replayGame()` re-deals the exact current seed.

`moveCard` validates via `core/rules.js` (single top card, or a full valid tableau run via
`getTableauRun`) and ignores illegal moves. `autoMove` cycles a clicked card's destination
through `DEST_ORDER` on repeated clicks (foundations first, then tableaus) and never
immediately reverses the previous auto-move. `autoComplete` gates first on `rules.isAllTableauFaceUp`:
when hidden cards remain it skips the solver and silently makes safe foundation moves (instant
greedy only). Once the tableau is fully revealed it proves a full win with
`solverClient.solveAsync` (run in a Web Worker so the UI never blocks) and animates the whole
winning line; if no win is provable it silently makes safe foundation moves. Each step is a
normal history entry. Before every mutating action the store captures a GSAP `Flip` snapshot
(`captureFlip`) so the animation layer can tween cards that reparent across `Pile` components.
It also drives `useStatsStore` (moves/timer), `useStatisticsStore` (win aggregation), and
`useUiStore` (dialogs/announcements); on a win it records the seed into `useSeedStore` and the
daily result into `db/dailyResults.js`.

### `src/hooks/useSettingsStore.js` (persisted, Dexie)

`theme`, `deck`, `handedness` ('left'|'right'), `highlightCard` (focus outline), `particles`
(foundation burst). Loaded async from Dexie on app start (`init()`), written through on change
(`setTheme`/`setDeck`/`setHandedness`/`setHighlightCard`/`setParticles`). `setDeck` also
activates the renderer in `deckRegistry`.

### `src/hooks/useStatsStore.js` (session, in-memory)

Moves counter, score (currently always 0 — not yet implemented), undos, and a wall-clock-based
play timer with **focus-loss pause** (hidden tab time is excluded via `pausedAt`/`pausedAccumMs`).
Enforces hard game-over limits: `MAX_TIME_MS` (30:00) and `MAX_MOVES` (500); reaching either
calls `freeze(reason)` and locks all interaction. `freeze` also records the loss immediately
(via `useStatisticsStore.recordLoss`, mirroring `recordWin` at win time and `recordGamePlayed`
at timer-start time), so the winning streak is reset the moment a limit is hit — Game Over is
a loss, not a streak-preserving outcome. The timer only starts once a real move exists
(`hasDeadEndMove`). Not persisted (per product decision).

### `src/hooks/useStatisticsStore.js` (persisted, Dexie `stats` table)

Cumulative, cross-session aggregates: `totalGamesPlayed`, `totalGamesWon`, `highestScore`,
`lowestTimeMs`, `lowestMoves`, `lowestUndos`, `currentStreak`, `bestStreak`. `recordWin` folds a
win in; `recordGamePlayed` counts a started game; `recordLoss` breaks the current streak
(preserving the best streak) and is invoked both by `finalizeGame` for an abandoned mid-play
game and by `useStatsStore.freeze` when a hard limit ends the game; `finalizeGame` only records
a loss for an in-progress (not-yet-ended) game, since a won or limit-ended game has its outcome
recorded at that moment. `reset` zeroes everything. Loaded via `init()`; updated through
`db/stats.js`.

### `src/hooks/useSeedStore.js` (persisted, Dexie `playedSeeds` table)

In-memory mirror of the set of **won Winning-Deal seeds** so `dealNewGame` can exclude them
synchronously. `addPlayedSeed(seed)` records a win; `resetPlayed()` clears. Intentionally
separate from `stats` so a statistics reset never clears seed history.

### `src/hooks/useAuthStore.js` (Supabase auth)

Anonymous session state backed by the shared Supabase client. `init()` establishes or resumes a
silent anonymous session (`supabase.auth.getSession` → `signInAnonymously`) and subscribes via
`onAuthStateChange`. Resolves `ready:true` in all cases and never blocks gameplay; a network
failure sets `authError` and leaves the app fully playable. Exposes `userId`, `isAnonymous`,
`ready`, `authError`. This is the foundation the leaderboards/achievements phase builds on.

### `src/hooks/useUiStore.js` (UI-only, ephemeral)

Keyboard-selected card id, `aria-live` announcement string, and dialog open flags (win,
no-moves, new-game picker, settings, statistics, daily-challenge, help, seed-input). Also
`findCardLocator(state, cardId)`, the active `hints` list (from `core/hints.js`), and drag
state (`isDragging`, `draggingFrom`) used to coordinate dnd-kit with CardView's tap→auto-move.
Includes `whenTransitionDone(tid)` / transition-completion plumbing used by the auto-complete
loop to chain steps only after each tween finishes.

## Drag engine (`src/hooks/useDragEngine.js`)

Thin `@dnd-kit` wrapper: `DndContext` + `PointerSensor` (8px activation distance, so a
sub-threshold tap becomes an auto-move rather than a drag). Card draggables carry
`{ from, cardId }`; pile droppables carry `{ loc }`. On drop, calls `moveCard`. Multi-card
run dragging: grabbing any face-up tableau card lifts the valid descending-alternating run
beneath it (`getTableauRun`); a `DragOverlay` (`RunPreview` in `Board.jsx`) renders the
lifted run stacked with the tableau fan offset.

**Keyboard / accessibility:** `KeyboardSensor` is intentionally **not** used. Focusable
cards (`tabIndex`/`role="button"`) perform an auto-move on Enter/Space; `Board.jsx` adds
global single-letter shortcuts (n=new, d=draw, r=recycle, u=undo, e=redo, a=auto-complete);
an `aria-live` region announces actions. Dialogs are in `components/`.

## Components (`src/components/`)

- `App.jsx` — root; loads `classic.css` + `dark.css` theme CSS and registers both deck
  renderers (side-effect imports); composes `Toolbar` + `Board`; shows `WinModal`. Runs
  `useAuthStore.init()` plus all store `init()`s on mount and wires the tab-focus timer pause.
- `Board.jsx` — responsive CSS-grid board (stock/waste/foundations top row, 7 tableau
  columns); handedness-aware ordering; DnD context, Flip move animation, win cascade,
  foundation particle burst, keyboard shortcuts, double-tap auto-complete.
- `Toolbar.jsx` — new game / undo / redo / auto-complete, theme + deck + handedness + card
  highlight + particles pickers, plus Daily Challenge and Seed-input launchers and the
  Statistics button.
- `Pile.jsx` — renders a pile (fanned tableau), droppable target, stock click-to-draw,
  drop-highlight gating by drag source.
- `CardView.jsx` — single card; canvas art from active renderer + 3D flip; tap/keyboard auto-move.
- `SettingsModal.jsx` (+ `HelpModal.jsx`), `NewGameModal.jsx`, `ConfirmModal.jsx`,
  `WinModal.jsx`, `StatisticsModal.jsx`, `DailyChallengeModal.jsx`, `SeedInputModal.jsx` — dialogs.
  - **Naming note:** `SettingsModal.jsx` is also referred to as the **Main Menu** — the two
    names are interchangeable and both refer to the same component. Its visible title is
    "Main Menu" and the toolbar button that opens it uses a hamburger (`Menu`) icon; the
    internal store flag is still `settingsDialogOpen`. (Originally built as "Settings".)
- `ToggleSwitch.jsx`, `modalBackdrop.js` — shared UI helpers.

## Modal dismissal rule

Every dialog is built from the shared primitives `useModalBackdrop` + `ModalCloseButton`
+ `useModalEscape` (see `modalStack.js` for the `Z` stacking levels). This contract
enforces outside-tap and Escape dismissal **automatically**:

- A modal is dismissed by tapping/clicking **outside** its panel (the backdrop) **or**
  pressing Escape. Tapping the exact trigger that opened the modal while it is already
  open also counts as "outside" and **dismisses it** — it must NOT re-open.
- The stray `click` that mobile browsers synthesize at the end of a touch gesture that
  closed a modal (landing on the trigger/FAB/row underneath the backdrop) is swallowed
  centrally inside `useModalBackdrop`, so re-opening cannot happen. **Do not** re-add
  per-button guards like the old `isModalDismissGuardActive()` check — the infrastructure
  owns this; per-button guards were the fragile pattern that got forgotten and caused
  regressions (e.g. the Achievements detail modal re-opening on mobile).
- **Non-dismissable modals are the only exception.** The "No More Moves" dialog (a
  `ConfirmModal` with `dismissable={false}`) must NOT be closable by outside tap — it
  deliberately omits the `backdrop` handlers (see `ConfirmModal.jsx`). Any future modal
  that must ignore outside taps follows the same `dismissable={false}` / "don't spread
  `backdrop`" convention.
- **When adding a new modal,** just use the three shared primitives and it gets correct
  dismissal (including the no-reopen guarantee) for free. No extra click-suppression code
  is needed or wanted at the call site.

## Rendering / animation (`src/render/`)

- `deck/` — `deckRegistry.js`, `drawCard.js` (shared canvas primitives), the two renderers.
- `animation/` — GSAP-wired layer: `gsapSetup.js` (exposes `Flip`), `flipBridge.js` (shared
  snapshot ref), `useCardMoveSlide.js` (reparent tween — formerly `useCardMoveFlip`),
  `useCardFaceFlip.js` (3D flip), `useStockDrawSlide.js` (stock→waste slide), `useFoundationParticles.js`
  + `particleBridge.js` (suit-burst effect, settings-toggleable), `winCascade.js`, `playCardShake.js`,
  `motion.js`, `MotionDebugPanel.jsx` (dev-only, gated by `import.meta.env.DEV`).
- `themes/` — `classic.css` and `dark.css` (selected via `theme-<name>` class on root).

## Persistence (`src/db/`)

`db/schema.js` defines a Dexie DB `klondike-solitaire` (currently version 4) with:

- `games` (`++id, startedAt, finishedAt, won, durationMs`) — `saveGame()` exists but is **not
  yet called** on game-over.
- `settings` (`key`) — settings + the daily last-selection key; wired through `useSettingsStore`.
- `stats` (`key`) — single cumulative-aggregate row; wired through `useStatisticsStore` / `db/stats.js`.
- `playedSeeds` (`key`) — won Winning-Deal seeds; wired through `useSeedStore` / `db/playedSeeds.js`.
- `dailyResults` (`date`) — best score/time/moves per completed daily day; wired through
  `db/dailyResults.js`. `dailySelection.js` persists the last-selected day in `settings`.

Scoring is unimplemented (`useStatsStore.score` is always 0), so persisted aggregates that
depend on score (`highestScore`) are currently 0-based.

## Data / scripts

- `data/solvableSeeds.json` — pre-verified solvable seeds.
- `data/dailyChallenge.json` (+ `.meta.json`) — bundled daily seeds + anchor/window metadata,
  consumed by `core/dailyChallenge.js`.
- `data/eventCatalog.src.json` — sample catalog demonstrating the new page/grid-aware format;
  consumed by `scripts/generateEventSeeds.mjs`.
- `data/dailyChallenge.json` (+ `.meta.json`) — bundled daily seeds + anchor/window metadata,
  consumed by `core/dailyChallenge.js`.
- `scripts/generateSolvablePool.mjs` — regenerates the solvable pool.
- `scripts/generateDaily.mjs` — generates the daily-challenge seed bundle.
- `scripts/generateEventSeeds.mjs` — generates page/grid-aware SQL for special events
  (Phase-1 Supabase schema, migration 022).
- `scripts/lib/seedHelpers.mjs` — shared solver plumbing (cyrb53, candidateGen, fillSeeds, solveBatch).
- `scripts/bump-version.cjs` — version bump helper.

## What is IMPLEMENTED vs STUBBED

### Implemented

- Full `core/` rules + pure move engine + deal + win detection + solvable pool.
- Project scaffolding: `package.json`, Vite, Tailwind v4, `index.html`, `main.jsx`, husky.
- `Board.jsx` responsive CSS-grid layout with correct initial deal (face-down + face-up).
- Single top-card **and** multi-card run drag-and-drop with `DragOverlay` run preview.
- One-tap / one-click auto-move (`rules.getAutoMoveTargets` + store `autoMove`) and
  auto-complete (`autoComplete`): proved-winnable via `solver.findWinningSequence`
  (includes stock/waste cycling), auto-fired when `solver.isAutoCompletable`
  (tableau fully revealed AND a win is provable). Manual trigger still makes safe
  foundation moves if no win is provable.
- Store: deal / draw / recycle / move / undo / redo / autoMove / autoComplete; Flip-capture
  integration for animations. Plus `dealDaily`, `replayGame`, won-seed exclusion.
- Both deck renderers (atlas slicing + procedural canvas) wired into `CardView` with 3D flip —
  no text placeholder.
- GSAP animations: deal/flip/move via Flip pipeline, win cascade, card shake, foundation
  particle burst, dev debug panel.
- Theme system (`classic` + `dark`), deck switcher, left/right handedness layout, card-highlight
  and particle settings toggles.
- Keyboard navigation + screen-reader support (focusable cards, global shortcuts, aria-live).
- Settings persistence via Dexie (`settings` table) including new toggles.
- **Supabase client + silent anonymous auth** (`lib/supabaseClient.js`, `hooks/useAuthStore.js`);
  offline-tolerant, never blocks play.
- **Daily Challenge**: bundled seeds, calendar UI, persistence of per-day bests + last selection,
  win flow with "Return to Daily".
- **Special Events**: page/grid-aware SQL authoring via `scripts/generateEventSeeds.mjs`
  (migration 022 template: `unnest(array[position...])::bigint[]`), consumes
  `scripts/eventCatalog.src.json`. SQL INSERTs for `special_events`/`special_event_pages`/`special_event_deals`.
- **Cumulative Statistics** (`stats` table) with win/loss aggregation, streaks, best
  score/time/moves; persisted and shown in `StatisticsModal`.
- Won-seed tracking (`playedSeeds`) so Winning-Deal seeds aren't repeated once won.
- Hint affordance (`core/hints.js` + `useUiStore.hints`) and board **snapshot export**
  (`core/snapshot.js` via Settings).
- Stats session (moves, undos, focus-paused timer, 30:00 / 500-move game-over limits) and dialogs.

### Stubbed / not yet started (marked with TODO in code)

- `audio/soundManager.js` — `play()` logs to console; no Howler playback, no sound files.
- `useSound.js` — `enabled` always true; no settings-driven mute; mute toggle is a no-op.
- `api/leaderboard.js` — localStorage mock; **not yet Supabase-backed and not wired to any UI**.
  Signatures (`submitScore`/`fetchTopScores`) are stable for a later swap-in.
- `useStatsStore.score` — always 0; scoring not implemented.
- Dexie `games` table — `saveGame()` defined but not invoked; game history not persisted.
- **Achievements** — not yet started (no module, no UI). The Supabase auth layer is the intended
  foundation for storing/querying them.

## Where the next pass picks up

1. **Leaderboards** — replace `api/leaderboard.js` localStorage with a real Supabase backend,
    wire `submitScore` on win (via `useAuthStore.userId`), and add a leaderboard UI.
2. **Achievements** — design the achievement set + Supabase storage/query, then build the module
   and UI (currently not started).
3. Implement scoring (replace the always-0 `useStatsStore.score`); flows into `stats.highestScore`.
4. Real Howler playback + sound files; settings-driven mute wired through `useSettingsStore`.
5. Persist finished games via `saveGame()` on game-over (Dexie `games` table).
6. (Optional) more themes; expand animation polish.
7. **Special-event seed authoring** — use `scripts/generateEventSeeds.mjs` with
   `scripts/eventCatalog.src.json` to produce migration 022 SQL for insertion into Supabase.

## Run

```bash
npm install
npm run dev      # dev server
npm run build    # production build
npm run lint     # eslint
npm test         # node --test (core unit tests)
```

## Commit Convention

When there are changes to commit, AI agents should suggest an one-line commit message at the end of their response following conventional commit format: `type(scope): description`. Use types like `feat`, `fix`, `refactor`, `docs`, `chore` and keep descriptions concise but descriptive — focus on the "why" rather than the "what".
