// render/deck/ProceduralDeckRenderer... (alias)
//
// Canvas-based deck renderer. Draws each card face (and the back) onto an
// offscreen canvas and returns a data URL consumable as a CSS background-image
// by CardView. Faces show a corner rank+suit index plus a large centered
// rank+suit in the card body. Results are cached per (suit, rank).
//
// Must remain framework-free (no React/DOM-logic imports) so the core stays
// unit-testable; only the browser `document` canvas API is used here.

import { registerDeck } from './deckRegistry.js';
import { drawCardFace, drawCardBack, drawLargeValueCardFace, colorOf } from './drawCard.js';

/**
 * @implements {import('./deckRegistry.js').DeckRenderer}
 */
export function createProceduralDeckRenderer({ size = 96, faceOptions, largeValue = false } = {}) {
  const w = size;
  const h = Math.round(size * 1.4);
  // Cache the encoded data-URL string (not the raw canvas), so repeated renders
  // — e.g. every card remounting on a new deal — reuse the PNG instead of
  // re-running the expensive toDataURL() encode each time.
  const cache = new Map();

  /** @param {string} key @param {(ctx: CanvasRenderingContext2D) => void} draw */
  function render(key, draw) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    draw(ctx);
    const url = canvas.toDataURL('image/png');
    cache.set(key, url);
    return url;
  }

  return {
    name: 'procedural',

    /**
     * @param {string} suit
     * @param {number} rank
     * @returns {string}
     */
    renderCard(suit, rank) {
      const key = `card:${suit}:${rank}`;
      if (largeValue) {
        return render(key, (ctx) => drawLargeValueCardFace(ctx, suit, rank, w, h, faceOptions));
      }
      return render(key, (ctx) => drawCardFace(ctx, suit, rank, w, h, faceOptions));
    },

    /**
     * @returns {string}
     */
    renderBack() {
      return render('back', (ctx) => drawCardBack(ctx, w, h));
    },

    /**
     * The deck's color for the given suit, used by the foundation particle
     * burst so each glyph matches the deck palette.
     * @param {string} suit
     * @returns {string}
     */
    suitColor(suit) {
      return (faceOptions?.colorFor ?? colorOf)(suit);
    },

    dispose() {
      cache.clear();
    },
  };
}

registerDeck('procedural', createProceduralDeckRenderer());

// 4-color deck: hearts red, spades black, clubs green, diamonds blue.
const FOUR_COLOR = {
  hearts: '#d12b3b',
  spades: '#1d2330',
  clubs: '#1e8a3b',
  diamonds: '#1f6fd6',
};

// 4-color deck #2: clubs black, diamonds yellow, hearts red, spades green.
const FOUR_COLOR_2 = {
  clubs: '#1d2330',
  diamonds: '#e0a800',
  hearts: '#d12b3b',
  spades: '#1e8a3b',
};

registerDeck('4-color', createProceduralDeckRenderer({ faceOptions: { colorFor: (s) => FOUR_COLOR[s] } }));
registerDeck('4-color-2', createProceduralDeckRenderer({ faceOptions: { colorFor: (s) => FOUR_COLOR_2[s] } }));

// Dark deck: no white face. Suit colors are brightened so the black suits
// (spades/clubs) remain readable on the dark slate background.
const DARK_COLOR = {
  hearts: '#ff6b7a',
  diamonds: '#ff8a5c',
  spades: '#e8ecf4',
  clubs: '#c7d2fe',
};

registerDeck(
  'procedural-dark',
  createProceduralDeckRenderer({
    faceOptions: {
      colorFor: (s) => DARK_COLOR[s],
      background: '#232936',
      border: 'rgba(255,255,255,0.22)',
    },
  })
);

// Dark 2: same dark slate face, but strictly 2-color (reddish + blueish).
// Red suits (hearts/diamonds) use coral-red; black suits (spades/clubs) sky-blue.
const DARK_2_COLOR = {
  hearts: '#ff5d6c',
  diamonds: '#ff5d6c',
  spades: '#5b8def',
  clubs: '#5b8def',
};

registerDeck(
  'procedural-dark-2',
  createProceduralDeckRenderer({
    faceOptions: {
      colorFor: (s) => DARK_2_COLOR[s],
      background: '#232936',
      border: 'rgba(255,255,255,0.22)',
    },
  })
);

// High-contrast: Okabe-Ito color-blind safe 4-color palette on white.
// Vermillion / amber / teal / blue remain distinguishable under
// deuteranopia/protanopia/tritanopia. Non-color cue: weight + underline
// makes each suit separable without color (2x2 matrix: weight 700 vs 800
// crossed with plain vs underline — clubs/spades heavy, diamonds/spades underlined).
const HIGH_CONTRAST = {
  hearts: '#D55E00',
  diamonds: '#E69F00',
  clubs: '#009E73',
  spades: '#0072B2',
};

const hcWeightFor = (s) => (s === 'clubs' || s === 'spades' ? 800 : 700);
const hcDecorationFor = (s) => (s === 'diamonds' || s === 'spades' ? 'underline' : null);

registerDeck(
  'high-contrast',
  createProceduralDeckRenderer({
    faceOptions: {
      colorFor: (s) => HIGH_CONTRAST[s],
      background: '#ffffff',
      border: '#000000',
      weightFor: hcWeightFor,
      decorationFor: hcDecorationFor,
    },
  })
);

const HIGH_CONTRAST_DARK = {
  hearts: '#ff7a3d',
  diamonds: '#ffca28',
  clubs: '#26c6a0',
  spades: '#64b5f6',
};

registerDeck(
  'high-contrast-dark',
  createProceduralDeckRenderer({
    faceOptions: {
      colorFor: (s) => HIGH_CONTRAST_DARK[s],
      background: '#232936',
      border: 'rgba(255,255,255,0.28)',
      weightFor: hcWeightFor,
      decorationFor: hcDecorationFor,
    },
  })
);

// Pastel: low-saturation 4-color palette on off-white.
// Spades darkened to muted slate (#6B6B8A) for contrast on light face.
// Same non-color cue as high-contrast so suits remain distinguishable.
const PASTEL = {
  hearts: '#e8a0b0',
  diamonds: '#8ec8e8',
  clubs: '#a8d5a2',
  spades: '#6b6b8a',
};

registerDeck(
  'pastel',
  createProceduralDeckRenderer({
    faceOptions: {
      colorFor: (s) => PASTEL[s],
      background: '#fbfbf7',
      border: 'rgba(0,0,0,0.14)',
      weightFor: hcWeightFor,
      decorationFor: hcDecorationFor,
    },
  })
);

const PASTEL_DARK = {
  hearts: '#f4b5c0',
  diamonds: '#a8d8ea',
  clubs: '#b8e6b8',
  spades: '#c9c9e8',
};

registerDeck(
  'pastel-dark',
  createProceduralDeckRenderer({
    faceOptions: {
      colorFor: (s) => PASTEL_DARK[s],
      background: '#232936',
      border: 'rgba(255,255,255,0.22)',
      weightFor: hcWeightFor,
      decorationFor: hcDecorationFor,
    },
  })
);

// 2-color high-contrast on warm parchment — wholly different hues from
// Okabe-Ito (burgundy vs teal), traditional pairing hearts+diamonds vs
// spades+clubs. New background #fdf6e3 distinguishes from #ffffff.
const HIGH_CONTRAST_2 = {
  hearts: '#6A1B2A',
  diamonds: '#6A1B2A',
  spades: '#0E4D6B',
  clubs: '#0E4D6B',
};

registerDeck(
  'high-contrast-2',
  createProceduralDeckRenderer({
    faceOptions: {
      colorFor: (s) => HIGH_CONTRAST_2[s],
      background: '#fdf6e3',
      border: 'rgba(60,40,20,0.22)',
      weightFor: hcWeightFor,
      decorationFor: hcDecorationFor,
    },
  })
);

// 2-color high-contrast dark on deep navy — bright coral vs turquoise on
// new background #1a2744 (not #232936), traditional pairing.
const HIGH_CONTRAST_DARK_2 = {
  hearts: '#FF6B6B',
  diamonds: '#FF6B6B',
  spades: '#4ECDC4',
  clubs: '#4ECDC4',
};

registerDeck(
  'high-contrast-dark-2',
  createProceduralDeckRenderer({
    faceOptions: {
      colorFor: (s) => HIGH_CONTRAST_DARK_2[s],
      background: '#1a2744',
      border: 'rgba(255,255,255,0.20)',
      weightFor: hcWeightFor,
      decorationFor: hcDecorationFor,
    },
  })
);

// 2-color pastel on kraft — wholly different dusty hues on new background
// #f5ecd7 (not #fbfbf7), traditional pairing.
const PASTEL_2 = {
  hearts: '#c97b84',
  diamonds: '#c97b84',
  spades: '#6ba3b7',
  clubs: '#6ba3b7',
};

registerDeck(
  'pastel-2',
  createProceduralDeckRenderer({
    faceOptions: {
      colorFor: (s) => PASTEL_2[s],
      background: '#f5ecd7',
      border: 'rgba(60,40,20,0.16)',
      weightFor: hcWeightFor,
      decorationFor: hcDecorationFor,
    },
  })
);

// 2-color pastel dark on muted grape — pale blush vs pale mist on new
// background #2a2438 (not #232936), traditional pairing.
const PASTEL_DARK_2 = {
  hearts: '#e8b4b8',
  diamonds: '#e8b4b8',
  spades: '#a8d0d8',
  clubs: '#a8d0d8',
};

registerDeck(
  'pastel-dark-2',
  createProceduralDeckRenderer({
    faceOptions: {
      colorFor: (s) => PASTEL_DARK_2[s],
      background: '#2a2438',
      border: 'rgba(255,255,255,0.18)',
      weightFor: hcWeightFor,
      decorationFor: hcDecorationFor,
    },
  })
);

const LARGE_VALUE = {
  hearts: '#d12b3b',
  diamonds: '#d12b3b',
  clubs: '#1d2330',
  spades: '#1d2330',
};

registerDeck(
  'large-value',
  createProceduralDeckRenderer({
    largeValue: true,
    faceOptions: {
      colorFor: (s) => LARGE_VALUE[s],
      background: '#fbfbf7',
      border: 'rgba(0,0,0,0.18)',
      weightFor: (s) => 800,
    },
  })
);

const LARGE_VALUE_DARK = {
  hearts: '#ff6b7a',
  diamonds: '#ff6b7a',
  clubs: '#e8ecf4',
  spades: '#e8ecf4',
};

registerDeck(
  'large-value-dark',
  createProceduralDeckRenderer({
    largeValue: true,
    faceOptions: {
      colorFor: (s) => LARGE_VALUE_DARK[s],
      background: '#232936',
      border: 'rgba(255,255,255,0.22)',
      weightFor: (s) => 800,
    },
  })
);

 registerDeck(
   'large-value-dark',
   createProceduralDeckRenderer({
    largeValue: true,
     faceOptions: {
       colorFor: (s) => LARGE_VALUE_DARK[s],
       background: '#232936',
       border: 'rgba(255,255,255,0.22)',
       weightFor: (s) => 800,
     },
   })
 );

// Large-value dark #2: near-black background (not #232936), magenta/cyan
// pairing for strong separation from the slate-blue original.
const LARGE_VALUE_DARK_2 = {
  hearts: '#ff7ab6',
  diamonds: '#ff7ab6',
  clubs: '#7ad7ff',
  spades: '#7ad7ff',
};

registerDeck(
  'large-value-dark-2',
  createProceduralDeckRenderer({
    largeValue: true,
    faceOptions: {
      colorFor: (s) => LARGE_VALUE_DARK_2[s],
      background: '#181425',
      border: 'rgba(255,255,255,0.24)',
      weightFor: (s) => 800,
    },
  })
);

// Large-value dark #3: deep navy background, warm amber/teal pairing for a
// third distinct dark large-value option.
const LARGE_VALUE_DARK_3 = {
  hearts: '#ffcf5c',
  diamonds: '#ffcf5c',
  clubs: '#5ce1c0',
  spades: '#5ce1c0',
};

registerDeck(
  'large-value-dark-3',
  createProceduralDeckRenderer({
    largeValue: true,
    faceOptions: {
      colorFor: (s) => LARGE_VALUE_DARK_3[s],
      background: '#0f1420',
      border: 'rgba(255,255,255,0.22)',
      weightFor: (s) => 800,
    },
  })
);