// render/deck/deckRegistry.js
//
// Registry mapping a theme/deck name to a concrete DeckRenderer implementation.
//
// RENDERER INTERFACE CONTRACT (every renderer must implement):
//   renderCard(suit, rank) -> string
//       suit: 'hearts'|'diamonds'|'clubs'|'spades'
//       rank: 1..13
//       returns: a string usable as a CSS `background` value or `<img src>`,
//                typically a data URL (`data:image/...`) or a CSS gradient string.
//   renderBack() -> string
//       returns: a string for the card back (CSS background value / data URL).
//   dispose() -> void   (optional) release any cached atlases / canvases.
//
// The CardView component consumes whatever the active renderer returns and
// applies it as a background-image; it does not care how the pixels are produced.

/**
 * @typedef {Object} DeckRenderer
 * @property {string} name
 * @property {(suit: string, rank: number) => string} renderCard
 * @property {() => string} renderBack
 * @property {() => void} [dispose]
 */

/** @type {Map<string, DeckRenderer>} */
const registry = new Map();

/**
 * Register a deck renderer under a name.
 * @param {string} name
 * @param {DeckRenderer} renderer
 */
export function registerDeck(name, renderer) {
  registry.set(name, renderer);
}

/**
 * Get a registered renderer by name. Falls back to 'procedural' if missing.
 * @param {string} [name]
 * @returns {DeckRenderer}
 */
export function getDeck(name = 'procedural') {
  const renderer = registry.get(name) ?? registry.get('procedural');
  if (!renderer) {
    throw new Error(`No deck renderer registered (requested "${name}")`);
  }
  return renderer;
}

/**
 * List registered renderer names.
 * @returns {string[]}
 */
export function listDecks() {
  return Array.from(registry.keys());
}
