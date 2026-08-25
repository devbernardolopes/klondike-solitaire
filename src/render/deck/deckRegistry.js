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
//   renderSuit(suit) -> string   (optional) a transparent data URL of the bare
//       suit glyph (used by particle effects).
//   dispose() -> void   (optional) release any cached atlases / canvases.
//
// The CardView component consumes whatever the active renderer returns and
// applies it as a background-image; it does not care how the pixels are produced.

/**
 * @typedef {Object} DeckRenderer
 * @property {string} name
 * @property {(suit: string, rank: number) => string} renderCard
 * @property {() => string} renderBack
 * @property {(suit: string) => string} [renderSuit]
 * @property {() => void} [dispose]
 */

/** @type {Map<string, DeckRenderer>} */
const registry = new Map();

/** Currently active renderer name (set via setActiveDeck). */
let activeName = 'procedural';

/**
 * Register a deck renderer under a name.
 * @param {string} name
 * @param {DeckRenderer} renderer
 */
export function registerDeck(name, renderer) {
  registry.set(name, renderer);
}

/**
 * Set the active renderer used by getDeck() when called with no name.
 * @param {string} name
 */
export function setActiveDeck(name) {
  if (!registry.has(name)) {
    throw new Error(`Cannot activate unregistered deck "${name}"`);
  }
  activeName = name;
}

/**
 * Get the active renderer name (e.g. for cache-busting memo deps).
 * @returns {string}
 */
export function getActiveDeckName() {
  return activeName;
}

/**
 * Get a registered renderer by name. Falls back to the active deck, then to
 * 'procedural' if missing.
 * @param {string} [name]  explicit name; when omitted the active deck is used.
 * @returns {DeckRenderer}
 */
export function getDeck(name) {
  const key = name ?? activeName;
  const renderer = registry.get(key) ?? registry.get('procedural');
  if (!renderer) {
    throw new Error(`No deck renderer registered (requested "${key}")`);
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
