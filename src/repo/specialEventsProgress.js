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
