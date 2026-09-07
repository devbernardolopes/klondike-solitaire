export const INTERFACE_THEMES = [
  { id: 'classic', tile: { background: '#ffffff', border: 'rgba(0,0,0,0.3)', color: '#1a1a1a' } },
  { id: 'dark', tile: { background: '#2a2f3a', border: 'rgba(255,255,255,0.3)', color: '#ffffff' } },
  { id: 'hc-dark', tile: { background: '#000000', border: '#ffffff', color: '#ffffff' } },
  { id: 'hc-light', tile: { background: '#ffffff', border: '#000000', color: '#000000' } },
  { id: 'pastel', tile: { background: '#fdf6ee', border: 'rgba(74,68,88,0.4)', color: '#4a4458' } },
  { id: 'arcade', tile: { background: '#0b0e1a', border: 'rgba(0,229,255,0.5)', color: '#e8f6ff' } },
];

export const INTERFACE_THEME_IDS = INTERFACE_THEMES.map((entry) => entry.id);

export function isInterfaceTheme(value) {
  return INTERFACE_THEME_IDS.includes(value);
}

export function tilePreviewOf(id) {
  const found = INTERFACE_THEMES.find((entry) => entry.id === id);
  return found ? found.tile : INTERFACE_THEMES[0].tile;
}
