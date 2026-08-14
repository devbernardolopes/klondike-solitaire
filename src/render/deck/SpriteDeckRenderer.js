// render/deck/SpriteDeckRenderer.js
//
// STUB renderer. Locks the interface (see deckRegistry.js) but does not slice a
// real sprite atlas yet.
//
// TODO(next pass): load the atlas image at `atlasPath`, maintain a lookup table
// of {suit, rank} -> source rect (x, y, w, h), and return a cropped data URL via
// an offscreen canvas (or precomputed <canvas> tiles). Until then, renderCard
// throws so any accidental use surfaces immediately.

import { registerDeck } from './deckRegistry.js';

/**
 * @implements {import('./deckRegistry.js').DeckRenderer}
 */
export function createSpriteDeckRenderer({ atlasPath = '/decks/classic.png' } = {}) {
  return {
    name: 'sprite',
    /**
     * @param {string} suit
     * @param {number} rank
     * @returns {string}
     */
    renderCard(suit, rank) {
      // TODO(next pass): slice atlas rect for (suit, rank) and return data URL.
      throw new Error(
        `SpriteDeckRenderer.renderCard(${suit}, ${rank}) not implemented — atlas slicing pending`,
      );
    },
    /**
     * @returns {string}
     */
    renderBack() {
      // TODO(next pass): slice the card-back rect from the atlas.
      throw new Error('SpriteDeckRenderer.renderBack() not implemented');
    },
    dispose() {
      // TODO(next pass): revoke object URLs / drop cached canvas tiles.
    },
  };
}

registerDeck('sprite', createSpriteDeckRenderer());
