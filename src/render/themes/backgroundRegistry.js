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
  // Phase-2 paid SVG line-art (Store-gated via store_items kind='table_felt';
  // NOT in ThemeModal FREE_BACKGROUNDS — shown only when owned).
  'crimson-deco': { name: 'Deco Fan', felt: '#7a1f2b', preview: 'radial-gradient(125% 95% at 50% 32%, #a83242 0%, #7a1f2b 52%, #4a0f18 100%)' },
  'emerald-suits': { name: 'Suit Outlines', felt: '#0e4a32', preview: 'radial-gradient(120% 90% at 50% 35%, #1e8a5c 0%, #0e4a32 55%, #08281c 100%)' },
  'desert-topo': { name: 'Dune Contours', felt: '#d4b896', preview: 'radial-gradient(125% 95% at 50% 30%, #e8d5b5 0%, #c9a87a 45%, #8c6a43 100%)' },
  'midnight-bauhaus': { name: 'Bauhaus Arcs', felt: '#0a1020', preview: 'radial-gradient(130% 100% at 50% 30%, #1a2744 0%, #0a1020 60%, #050a16 100%)' },
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
  // Phase-2 SVG line-art tiles (240px; single-quoted attrs, < > # encoded so
  // the same string is valid inline in JS and inside felts.css url("...")).
  // White strokes at 0.10 on dark felts; dark-brown at 0.12 on desert-topo
  // where white would wash out on the light sand base.
  'crimson-deco': {
    image: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'240\' height=\'240\' viewBox=\'0 0 240 240\' fill=\'none\' stroke=\'white\' stroke-opacity=\'0.1\' stroke-width=\'1.5\'%3E%3Ccircle cx=\'120\' cy=\'262\' r=\'62\'/%3E%3Ccircle cx=\'120\' cy=\'262\' r=\'102\'/%3E%3Ccircle cx=\'120\' cy=\'262\' r=\'142\'/%3E%3Ccircle cx=\'120\' cy=\'262\' r=\'182\'/%3E%3Ccircle cx=\'120\' cy=\'262\' r=\'222\'/%3E%3Cpath d=\'M120 262L-20 62\'/%3E%3Cpath d=\'M120 262L40 22\'/%3E%3Cpath d=\'M120 262L120 2\'/%3E%3Cpath d=\'M120 262L200 22\'/%3E%3Cpath d=\'M120 262L260 62\'/%3E%3C/svg%3E")',
    size: '240px 240px',
  },
  'emerald-suits': {
    image: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'240\' height=\'240\' viewBox=\'0 0 240 240\' fill=\'none\' stroke=\'white\' stroke-opacity=\'0.1\' stroke-width=\'1.5\'%3E%3Cpath d=\'M60 78C42 64 40 48 50 44C55 42 59 46 60 50C61 46 65 42 70 44C80 48 78 64 60 78Z\'/%3E%3Cpath d=\'M180 38L198 62L180 86L162 62Z\'/%3E%3Cpath d=\'M60 158C78 172 80 188 70 192C65 194 61 190 60 186C59 190 55 194 50 192C40 188 42 172 60 158Z\'/%3E%3Cpath d=\'M60 192L60 202M53 202L67 202\'/%3E%3Ccircle cx=\'180\' cy=\'166\' r=\'10\'/%3E%3Ccircle cx=\'170\' cy=\'182\' r=\'10\'/%3E%3Ccircle cx=\'190\' cy=\'182\' r=\'10\'/%3E%3Cpath d=\'M180 190L180 202M173 202L187 202\'/%3E%3C/svg%3E")',
    size: '240px 240px',
  },
  'desert-topo': {
    image: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'240\' height=\'240\' viewBox=\'0 0 240 240\' fill=\'none\' stroke=\'%233d2c17\' stroke-opacity=\'0.12\' stroke-width=\'1.5\'%3E%3Cpath d=\'M-10 42C40 22 80 62 130 42C170 27 200 52 250 37\'/%3E%3Cpath d=\'M-10 92C40 72 80 112 130 92C170 77 200 102 250 87\'/%3E%3Cpath d=\'M-10 142C40 122 80 162 130 142C170 127 200 152 250 137\'/%3E%3Cpath d=\'M-10 192C40 172 80 212 130 192C170 177 200 202 250 187\'/%3E%3Cpath d=\'M-10 242C40 222 80 262 130 242C170 227 200 252 250 237\'/%3E%3C/svg%3E")',
    size: '240px 240px',
  },
  'midnight-bauhaus': {
    image: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'240\' height=\'240\' viewBox=\'0 0 240 240\' fill=\'none\' stroke=\'white\' stroke-opacity=\'0.1\' stroke-width=\'1.5\'%3E%3Cpath d=\'M120 0A120 120 0 0 0 0 120\'/%3E%3Cpath d=\'M90 0A90 90 0 0 0 0 90\'/%3E%3Cpath d=\'M60 0A60 60 0 0 0 0 60\'/%3E%3Cpath d=\'M120 240A60 60 0 0 1 240 240\'/%3E%3Cpath d=\'M150 240A30 30 0 0 1 210 240\'/%3E%3Ccircle cx=\'180\' cy=\'60\' r=\'22\'/%3E%3Cpath d=\'M0 180H60\'/%3E%3Cpath d=\'M180 120V180\'/%3E%3C/svg%3E")',
    size: '240px 240px',
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
