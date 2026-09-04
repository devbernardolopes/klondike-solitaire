const LS_KEY = 'klondike:dissolveSeen';

function loadSet() {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveSet(set) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_KEY, JSON.stringify([...set]));
  } catch {}
}

const memory = loadSet();

export function hasSeenDissolve(dealId) {
  return memory.has(String(dealId));
}

export function markSeenDissolve(dealId) {
  const key = String(dealId);
  if (memory.has(key)) return;
  memory.add(key);
  saveSet(memory);
}
