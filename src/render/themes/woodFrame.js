const cache = new Map();

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getWoodTextureUrl({ seed = 99, w = 512, h = 512 } = {}) {
  const key = `${seed}:${w}x${h}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.fillStyle = '#3d2810';
  ctx.fillRect(0, 0, w, h);
  const baseGrad = ctx.createLinearGradient(0, 0, 0, h);
  baseGrad.addColorStop(0, '#4a3216');
  baseGrad.addColorStop(0.5, '#3d2810');
  baseGrad.addColorStop(1, '#2e1e0c');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 2) {
    const jitter = (rnd() - 0.5) * 8;
    const alpha = 0.04 + rnd() * 0.06;
    ctx.strokeStyle = `rgba(${40 + jitter}, ${24 + jitter}, ${12 + jitter}, ${alpha})`;
    ctx.lineWidth = 1 + rnd() * 2.5;
    ctx.beginPath();
    for (let x = 0; x < w; x += 10) {
      const wave = Math.sin((x / w) * Math.PI * 2 + rnd() * 0.5) * 3 + Math.sin((y / h) * Math.PI * 8) * 4;
      const yy = y + wave + (rnd() - 0.5) * 2;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 40; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const len = 20 + rnd() * 80;
    ctx.strokeStyle = `rgba(0,0,0,${0.06 + rnd() * 0.08})`;
    ctx.lineWidth = 0.5 + rnd() * 1.2;
    ctx.beginPath();
    ctx.ellipse(x, y, len * 0.5, 2, rnd() * 0.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  const highlight = ctx.createLinearGradient(0, 0, 0, 28);
  highlight.addColorStop(0, 'rgba(255,255,255,0.18)');
  highlight.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = highlight;
  ctx.fillRect(0, 0, w, 28);
  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

export function applyWoodFrame() {
  try {
    const url = getWoodTextureUrl({});
    document.documentElement.style.setProperty('--wood-texture', `url("${url}")`);
  } catch {}
}

export function removeWoodFrame() {
  try {
    document.documentElement.style.removeProperty('--wood-texture');
  } catch {}
}
