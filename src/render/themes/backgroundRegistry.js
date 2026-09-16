const BACKGROUNDS = {
  classic: { name: 'Classic', felt: '#1f7a4d', preview: '#1f7a4d' },
  dark: { name: 'Dark', felt: '#11151c', preview: '#11151c' },
  midnight: { name: 'Midnight', felt: '#0d1b2a', preview: 'radial-gradient(115% 85% at 50% 30%, #143352 0%, #0d1b2a 58%, #0a1520 100%)' },
  forest: { name: 'Forest', felt: '#1a3c2a', preview: 'radial-gradient(118% 88% at 50% 32%, #2a5a3a 0%, #1a3c2a 55%, #122b1e 100%)' },
  desert: { name: 'Desert', felt: '#c2a878', preview: 'radial-gradient(120% 90% at 50% 28%, #d9c49a 0%, #c2a878 50%, #a68c5e 100%)' },
  noir: { name: 'Noir', felt: '#1a1a1a', preview: 'radial-gradient(120% 90% at 50% 35%, #2a2a2a 0%, #1a1a1a 55%, #0f0f0f 100%)' },
  'retro-crt': { name: 'Retro CRT', felt: '#111811', preview: 'radial-gradient(120% 90% at 50% 30%, #1c2a1c 0%, #111811 55%, #0b110b 100%)' },
  'emerald-depth': { name: 'Emerald Depth', felt: '#0e4a32', preview: 'radial-gradient(120% 90% at 50% 35%, #1e8a5c 0%, #0e4a32 55%, #08281c 100%)' },
  'midnight-velvet': { name: 'Midnight Velvet', felt: '#0a1020', preview: 'radial-gradient(130% 100% at 50% 30%, #1a2744 0%, #0a1020 60%, #050a16 100%)' },
  'crimson-baize': { name: 'Crimson Baize', felt: '#7a1f2b', preview: 'radial-gradient(125% 95% at 50% 32%, #a83242 0%, #7a1f2b 52%, #4a0f18 100%)' },
  'desert-mirage': { name: 'Desert Mirage', felt: '#d4b896', preview: 'radial-gradient(125% 95% at 50% 30%, #e8d5b5 0%, #c9a87a 45%, #8c6a43 100%)' },
  // Phase-1 free geometric patterns (pure CSS, subtle alpha so cards stay legible).
  'emerald-checker': { name: 'Emerald Checker', felt: '#1f7a4d', preview: 'radial-gradient(120% 90% at 50% 32%, #2a8a5c 0%, #1f7a4d 55%, #14532e 100%)' },
  'midnight-pinstripe': { name: 'Midnight Pinstripe', felt: '#0d1b2a', preview: 'radial-gradient(115% 85% at 50% 30%, #143352 0%, #0d1b2a 58%, #0a1520 100%)' },
  'forest-dots': { name: 'Forest Dots', felt: '#1a3c2a', preview: 'radial-gradient(118% 88% at 50% 32%, #2a5a3a 0%, #1a3c2a 55%, #122b1e 100%)' },
  'noir-diagonal': { name: 'Noir Diagonal', felt: '#1a1a1a', preview: 'radial-gradient(120% 90% at 50% 35%, #2a2a2a 0%, #1a1a1a 55%, #0f0f0f 100%)' },
};

// Subtle programmatic patterns layered over the felt gradient via
// `--felt-pattern` (see felts.css + App.jsx 3-layer stack). Alphas are kept
// at 0.05–0.10 so red/black card faces and empty-pile outlines stay legible
// on both desktop and 360px mobile. Repeating gradients tile infinitely
// (size agnostic); the dot/checker entries need an explicit tile size.
const PATTERNS = {
  'emerald-checker': {
    image: 'repeating-conic-gradient(rgba(255,255,255,0.07) 0% 25%, transparent 0% 50%)',
    size: '32px 32px',
  },
  'midnight-pinstripe': {
    image: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 12px)',
    size: 'auto',
  },
  'forest-dots': {
    image: 'radial-gradient(rgba(255,255,255,0.10) 1.2px, transparent 1.4px)',
    size: '18px 18px',
  },
  'noir-diagonal': {
    image: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 10px)',
    size: 'auto',
  },
};

export function getBackground(key) {
  return BACKGROUNDS[key] ?? null;
}

export function listBackgrounds() {
  return Object.keys(BACKGROUNDS);
}

export function feltColorOf(key) {
  return BACKGROUNDS[key]?.felt ?? null;
}

export function previewBackgroundOf(key) {
  return BACKGROUNDS[key]?.preview ?? BACKGROUNDS[key]?.felt ?? null;
}

/** CSS `background-image` value for the programmatic pattern layer, or null. */
export function patternBackgroundOf(key) {
  return PATTERNS[key]?.image ?? null;
}

/** CSS `background-size` value for the pattern layer (`auto` when n/a). */
export function patternSizeOf(key) {
  return PATTERNS[key]?.size ?? 'auto';
}
