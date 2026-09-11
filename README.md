# Klondike Solitaire

A framework-agnostic implementation of Klondike solitaire with real game rules, drag-and-drop UI, and comprehensive gameplay features.

## Features

- Favorites: save the current deal by seed and replay it later via Main Menu > Favorites (`src/hooks/useFavoritesStore.js`, `src/components/FavoritesModal.jsx`).
- History: per-game record (result, moves, time, kind, seed) from Supabase `game_results` plus pending outbox rows (`src/components/HistoryModal.jsx`, `src/components/HistoryDetailModal.jsx`, `src/repo/gameHistoryRepository.js`).
- Playback: step through a recorded game from its `move_log` (`src/hooks/usePlaybackStore.js`, `src/components/PlaybackBar.jsx`).
- Device synchronization: offline-first outbox (`src/db/syncQueue.js`, `src/sync/syncEngine.js`) flushes results, favorites, and session; active session restores across reloads (`src/db/activeSession.js`); factory reset propagates across devices (`src/sync/factoryReset.js`).
- Leaderboard: Supabase `leaderboard` view with coins, wins, streak, time, and moves tabs; opt-out supported (`src/components/LeaderboardModal.jsx`, `submit_game_result` RPC).
- Themes and decks: Classic and Dark themes; sprite and procedural card renderers (`src/render/deck/`); left/right handedness layout; card highlight and particle toggles (`src/hooks/useSettingsStore.js`).
- Achievements: telemetry-driven unlocks with catalog cache, detail views, and toasts (`src/core/achievementTelemetry.js`, `src/components/AchievementsModal.jsx`, `src/hooks/useAchievementEventsStore.js`).
- Store and coins: coin balance, reward rules, and item purchase via `purchase_item` (`src/components/StoreModal.jsx`, `src/core/coinRewards.js`).
- Input: mouse drag (`@dnd-kit`, multi-card runs), tap/click auto-move, keyboard shortcuts and focusable cards, touch support (`src/hooks/useDragEngine.js`, `src/components/Board.jsx`).
- Statistics: cumulative games, wins, streaks, best time/moves/undos (`src/components/StatisticsModal.jsx`, `src/hooks/useStatisticsStore.js`).
- Game assistance: hints (`src/core/hints.js`), undo/redo, auto-complete via Web Worker solver (`src/core/solverClient.js`), board snapshot export (`src/core/snapshot.js`).
- Audio: synthesized Web Audio SFX with no audio files, plus mute and volume controls (`src/audio/AudioEngine.js`, `src/audio/index.js`, `src/store/useSoundStore.js`).
- Animation: GSAP-based Flip pipeline for card movements, win cascade, and foundation particle burst (`src/render/animation/`).
- Daily Challenge and Special Events: dated and event-based curated deals with calendar/grid UI and offline seed cache (`src/components/DailyChallengeModal.jsx`, `src/components/SpecialEventsModal.jsx`, `src/repo/seedRepository.js`).
- Settings and persistence: Dexie-backed preferences with localStorage first-paint mirror (`src/db/schema.js`); six locales (en/fr/de/it/es/pt-BR) with DB-mirrored catalog sync (`npm run i18n:check`).
- Offline-first: remains fully playable without network or Supabase access; unauthenticated mode degrades to local-only play (`src/lib/supabaseClient.js`).

## Game Modes

The project includes three types of game deals, each with solver-verified winning combinations:

### Winning Deal (Random)
Standard random deals from a pre-verified pool of solvable games. Each seed guarantees a solvable game with at least one winning path.

### Daily Challenge
One solver-verified seed per day, based on an anchor date (2026-01-01) with a 5-year window. Features are bundled in `data/dailyChallenge.json`.

### Special Events
Page/grid-aware SQL authoring via `scripts/generateEventSeeds.mjs` (migration 022 template: `unnest(array[position...])::bigint[]`), consumes `scripts/eventCatalog.src.json`. SQL INSERTs for `special_events`/`special_event_pages`/`special_event_deals` are pasted into the Supabase Dashboard SQL Editor.

See the **Seed Generation** section below for the generation workflow.

## Deal algorithm

Every deal starts from a `uint32` seed (`0..2**32-1`). The seed drives a
Mulberry32 PRNG through a Fisher–Yates shuffle of the standard 52-card deck
(`src/core/Deck.js`), then `src/core/dealer.js` deals tableau `1+2+…+7` (last
card face-up) with the remaining 24 as stock. Same seed → same deal, on every
device.

Curated seeds (winning pool, daily, special events) are pre-verified solvable:
each seed is kept only after a solver actually plays it out to 52/52
foundations, so the pool never contains false positives. Random Shuffle deals
pick `Math.floor(Math.random() * 2**32)` via `src/core/randomSeed.js`, rejecting
every curated seed plus every previously dealt random seed, so they never repeat
another mode.

## Solver

Bounded depth-first search with memoization (`src/core/solver.js` at runtime,
`scripts/lib/seedSolver.mjs` offline — same rules, same verdicts). States are
hashed (`stock|waste|foundations|tableau`) to prune draw/recycle cycles;
foundation moves are tried first, then tableau runs, then draw/recycle. Budgets
(`maxNodes`/`maxMs`) bound the search: it returns a winning move list, `null`
(space exhausted — proven dead end), or timeout (unknown, never treated as
dead). The UI runs it in a Web Worker (`src/core/solverClient.js`) so the board
never blocks.

## Seed Generation

Uniqueness comes from exclusion, not ranges: every generator starts from the
shared set in `scripts/lib/seedRegistry.mjs`
(`solvableSeeds.json` + `dailyChallenge.json` + `eventSeeds.sql`, local files
only), so **run order no longer matters**. Verify any time with:

```bash
npm run seeds:check
```

This is blocking: it runs as part of `npm test` and fails on any cross-mode
reuse or internal duplicate.

### Winning Deal Seeds

```bash
npm run winning:regenerate -- --dry-run --count 50   # preview, writes nothing
npm run winning:regenerate -- --count 2000 --skip-db  # write JSON only
npm run winning:regenerate -- --count 2000            # + upsert winning_seeds (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
```

Starting point is `cyrb53("winning-pool-v2")`, then `base,+1,-1,+2,-2…`,
solver-verified, excluding every daily + event seed. Replaces the pool
wholesale (old pool seeds are released).

### Daily Challenge Seeds

```bash
node scripts/generateDaily.mjs            # full run -> src/data/dailyChallenge.json
node scripts/generateDaily.mjs --smoke    # stub solver self-check, no writes to data dir
```

One seed per date from `DAILY_ANCHOR` (`2026-01-01`) over `DAILY_WINDOW_YEARS`
(`5`); each date hashes (`cyrb53(date)`) and walks outward to the nearest
solvable seed outside the global set.

### Special Event Seeds

```bash
node scripts/generateEventSeeds.mjs --catalog scripts/eventCatalog.src.json --out scripts/eventSeeds.sql
node scripts/generateEventSeeds.mjs --smoke    # stub solver self-check
node scripts/event:new                         # interactive wizard (catalog + locales + SQL + optional DB)
```

Each page hashes (`cyrb53("<eventId>:page<N>")`) and fills `gridSize²`
solver-verified seeds. Output is migration-022 SQL
(`unnest(array[position…])`, `deal_number` event-sequential) — paste into
Supabase Dashboard → SQL Editor. `--resume` skips already-authored pages;
re-runs without it still exclude old event seeds.

### Publishing

```bash
node scripts/pushSeeds.mjs --dry-run   # report counts, no writes
node scripts/pushSeeds.mjs             # upsert winning_seeds + daily_seeds
```

Events are published via the SQL file above, not `pushSeeds.mjs`. The app reads
live Supabase tables first (`src/repo/seedRepository.js`) with the bundled JSON
as offline fallback.

## Build & Run

```bash
npm install
npm run dev      # Development server
npm run build    # Production build
npm run lint     # ESLint checks
npm test         # Core unit tests (Node)
```

## Architecture

**Core (`src/core/`)**
- Framework-agnostic game logic
- Pure functions for moves, rules, and solving
- Unit-testable in isolation

**UI (`src/components/`)**
- React-based interface with Zustand store
- Drag-and-drop with `@dnd-kit`
- GSAP animations and effects

**Data (`src/db/`)**
- IndexedDB persistence for stats and settings
- Supabase integration for auth and leaderboards

**Rendering (`src/render/`)**
- Card renderers (Sprite and Procedural)
- Animation pipelines
- Theme system (Classic + Dark)
