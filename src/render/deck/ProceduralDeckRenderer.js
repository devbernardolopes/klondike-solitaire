// render/deck/ProceduralDeckRenderer.js
//
// STUB renderer. Locks the interface (see deckRegistry.js) but does not draw a
// real card face via canvas primitives yet.
//
// TODO(next pass): draw the card face (rounded rect, rank pips, suit glyph, color)
// onto an offscreen canvas and return canvas.toDataURL(). For now renderCard
// throws so it cannot be confused with a working renderer.

import { registerDeck } from './deckRegistry.js';

/**
 * @implements {import('./deckRegistry.js').DeckRenderer}
 */
export function createProceduralDeckRenderer({ size = 96 } = {}) {
  return {
    name: 'procedural',
    /**
     * @param {string} suit
     * @param {number} rank
     * @returns {string}
     */
    renderCard(suit, rank) {
      // TODO(next pass): canvas-draw face for (suit, rank), return data URL.
      throw new Error(
        `ProceduralDeckRenderer.renderCard(${suit}, ${rank}) not implemented — canvas drawing pending`,
      );
    },
    /**
     * @returns {string}
     */
    renderBack() {
      // TODO(next pass): canvas-draw a card back pattern, return data URL.
      throw new Error('ProceduralDeckRenderer.renderBack() not implemented');
    },
    dispose() {
      // no-op for now
    },
  };
}

registerDeck('procedural', createProceduralDeckRenderer());
