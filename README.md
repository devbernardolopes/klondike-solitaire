# Klondike Solitaire

A framework-agnostic implementation of Klondike solitaire with real game rules, drag-and-drop UI, and comprehensive gameplay features.

## Game Modes

The project includes three types of game deals, each with solver-verified winning combinations:

### Winning Deal (Random)
Standard random deals from a pre-verified pool of solvable games. Each seed guarantees a solvable game with at least one winning path.

### Daily Challenge
One solver-verified seed per day, based on an anchor date (2026-01-01) with a 5-year window. Features are bundled in `data/dailyChallenge.json`.

### Special Events
Curated events with 50 solver-verified seeds each. Events are defined in `data/eventCatalog.json` and bundled in `data/specialEvents.json`.

## Seed Generation

All seed types use the real core move engine to guarantee accurate solvability verification. Generated seeds are globally unique across all game modes.

### Winning Deal Seeds
Generate the main solvable pool using the `generateSolvablePool.mjs` script:

```bash
node scripts/generateSolvablePool.mjs
```

**Environment variables (optional):**
- `SEED_RANGE_START`: Starting seed for the scan (default: 0)
- `SEED_RANGE_END`: Ending seed for the scan (default: 50000)
- `TARGET_POOL_SIZE`: Target number of seeds to generate (default: 2000)
- `OUT_PATH`: Custom output path for the seed pool
- `SOLVER_PATH`: Path to the KlondikeSolver binary for faster generation

**Features:**
- Resume capability via `solvableSeeds.meta.json`
- Fast binary path when KlondikeSolver is available
- Fallback to embedded pure-JS solver
- Guarantees no false positives (only false negatives possible)

### Daily Challenge + Special Event Seeds
Generate bundled seeds using the `generateFeatures.mjs` script:

```bash
node scripts/generateFeatures.mjs
```

**Environment variables (optional):**
- `DAILY_ANCHOR`: Starting date for daily seeds (default: "2026-01-01")
- `DAILY_WINDOW_YEARS`: Duration in years for daily seeds (default: 5)
- `DAILY_LIMIT`: Number of daily seeds to generate (unlimited by default)
- `SOLVER_PATH`: Path to the KlondikeSolver binary for faster generation

**Features:**
- Incremental event generation preserves existing seeds
- Global uniqueness across all seed types
- Support for smoke testing with `--smoke` flag
- Customizable output directory with `--out <path>`

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/generateSolvablePool.mjs` | Generate Winning Deal seed pool |
| `scripts/generateFeatures.mjs` | Generate Daily Challenge + Special Event seeds |
| `scripts/bump-version.cjs` | Version bump helper |

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

## Technical Highlights

- **Solver**: Pure JS implementation with Web Worker integration for off-main-thread solving
- **Animation**: GSAP-based Flip pipeline for smooth card movements
- **Persistence**: Dexie.js for local storage, Supabase for cloud sync
- **Accessibility**: Keyboard navigation, screen reader support, ARIA live regions
- **Offline-first**: Graceful degradation without network or Supabase access
