const BACKGROUNDS = {
  classic: { name: 'Classic', felt: '#1f7a4d' },
  dark: { name: 'Dark', felt: '#11151c' },
  midnight: { name: 'Midnight', felt: '#0d1b2a' },
  forest: { name: 'Forest', felt: '#1a3c2a' },
  desert: { name: 'Desert', felt: '#c2a878' },
  noir: { name: 'Noir', felt: '#1a1a1a' },
  'retro-crt': { name: 'Retro CRT', felt: '#111811' },
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
