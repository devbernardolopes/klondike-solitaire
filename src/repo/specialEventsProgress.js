export function recomputeUnlocks(detail) {
  if (!detail || !Array.isArray(detail.pages)) return detail;
  let prevCompleted = true;
  for (const p of detail.pages) {
    const allSolved = p.deals.length > 0 && p.deals.every((d) => d.solved);
    const completed = p.completed || allSolved;
    const unlocked = prevCompleted;
    p.completed = completed;
    p.unlocked = unlocked;
    prevCompleted = completed;
  }
  return detail;
}

export function applyOptimisticSolve(detail, dealId) {
  if (!detail || dealId == null) return detail;
  let patched = false;
  for (const p of detail.pages) {
    for (const d of p.deals) {
      if (d.id === dealId && !d.solved) {
        d.solved = true;
        patched = true;
      }
    }
  }
  if (patched) recomputeUnlocks(detail);
  return detail;
}

export function cloneDetail(detail) {
  if (!detail) return detail;
  return {
    ...detail,
    pages: detail.pages.map((p) => ({
      ...p,
      deals: p.deals.map((d) => ({ ...d })),
    })),
  };
}

export function collectSolvedIds(detail) {
  const ids = new Set();
  if (!detail || !Array.isArray(detail.pages)) return ids;
  for (const p of detail.pages) {
    for (const d of p.deals || []) {
      if (d.solved) ids.add(d.id);
    }
  }
  return ids;
}

export function mergeSolvedIds(detail, solvedIds) {
  if (!detail || !solvedIds || solvedIds.size === 0) return detail;
  let patched = false;
  for (const p of detail.pages) {
    for (const d of p.deals || []) {
      if (!d.solved && solvedIds.has(d.id)) {
        d.solved = true;
        patched = true;
      }
    }
  }
  if (patched) recomputeUnlocks(detail);
  return detail;
}

export function findNextUnsolvedDeal(detail, wonDealId) {
  if (!detail || !Array.isArray(detail.pages) || wonDealId == null) return null;
  const flat = [];
  for (const p of detail.pages) {
    for (const deal of p.deals || []) {
      flat.push({ deal, pageNumber: p.pageNumber });
    }
  }
  const wonIdx = flat.findIndex((f) => f.deal.id === wonDealId);
  if (wonIdx < 0) return null;
  for (let i = wonIdx + 1; i < flat.length; i++) {
    if (flat[i].deal.id === wonDealId) continue;
    if (!flat[i].deal.solved) return flat[i];
  }
  return null;
}
