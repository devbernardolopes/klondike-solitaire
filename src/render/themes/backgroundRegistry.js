const BACKGROUNDS = {
  classic: { name: 'Classic', felt: '#1f7a4d' },
  dark: { name: 'Dark', felt: '#11151c' },
  midnight: { name: 'Midnight', felt: '#0d1b2a' },
  forest: { name: 'Forest', felt: '#1a3c2a' },
  desert: { name: 'Desert', felt: '#c2a878' },
  noir: { name: 'Noir', felt: '#1a1a1a' },
  'retro-crt': { name: 'Retro CRT', felt: '#111811' },
  'emerald-depth': { name: 'Emerald Depth', felt: '#0e4a32' },
  'midnight-velvet': { name: 'Midnight Velvet', felt: '#0a1020' },
  'crimson-baize': { name: 'Crimson Baize', felt: '#7a1f2b' },
  'desert-mirage': { name: 'Desert Mirage', felt: '#d4b896' },
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
