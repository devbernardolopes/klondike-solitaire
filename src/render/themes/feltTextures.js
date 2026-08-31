const cache = new Map();

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoiseTexture({ seed = 1, size = 256, density = 0.5, opacity = 0.07, tint = null } = {}) {
  const key = `${seed}:${size}:${density}:${opacity}:${tint ?? 'none'}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.clearRect(0, 0, size, size);
  if (tint) {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, size, size);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (rnd() > density) continue;
      const v = Math.floor(rnd() * 255);
      const a = opacity * (0.5 + rnd() * 0.5);
      ctx.fillStyle = `rgba(${v},${v},${v},${a})`;
      const s = rnd() < 0.7 ? 1 : 2;
      ctx.fillRect(x, y, s, s);
    }
  }
  for (let i = 0; i < size * 0.6; i++) {
    const x = Math.floor(rnd() * size);
    const y = Math.floor(rnd() * size);
    const len = 6 + Math.floor(rnd() * 18);
    const angle = rnd() * Math.PI;
    ctx.strokeStyle = `rgba(0,0,0,${opacity * 0.35})`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }
  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

const TEXTURE_PRESETS = {
  'emerald-depth': { seed: 11, tint: 'rgba(14,74,50,0)', opacity: 0.09, density: 0.48 },
  'midnight-velvet': { seed: 22, tint: 'rgba(10,16,32,0)', opacity: 0.1, density: 0.42 },
  'crimson-baize': { seed: 33, tint: 'rgba(122,31,43,0)', opacity: 0.08, density: 0.5 },
  'desert-mirage': { seed: 44, tint: 'rgba(212,184,150,0)', opacity: 0.07, density: 0.55 },
  classic: { seed: 1, tint: 'rgba(31,122,77,0)', opacity: 0.06, density: 0.45 },
  midnight: { seed: 2, tint: null, opacity: 0.07, density: 0.4 },
  forest: { seed: 3, tint: null, opacity: 0.06, density: 0.45 },
  desert: { seed: 4, tint: null, opacity: 0.05, density: 0.5 },
};

export function getFeltTextureUrl(theme) {
  const preset = TEXTURE_PRESETS[theme];
  if (!preset) return null;
  try {
    return makeNoiseTexture(preset);
  } catch {
    return null;
  }
}

export function applyFeltTexture(theme) {
  const url = getFeltTextureUrl(theme);
  const root = document.documentElement;
  if (url) {
    root.style.setProperty('--felt-texture', `url("${url}")`);
  } else {
    root.style.removeProperty('--felt-texture');
  }
}
