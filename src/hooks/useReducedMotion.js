import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function isReducedMotion() {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(QUERY).matches === true;
  } catch {
    return false;
  }
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(isReducedMotion);
  useEffect(() => {
    let mql = null;
    let onChange = null;
    try {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
      mql = window.matchMedia(QUERY);
      onChange = (e) => setReduced(e.matches === true);
      setReduced(mql.matches === true);
      if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
      else if (typeof mql.addListener === 'function') mql.addListener(onChange);
    } catch {}
    return () => {
      try {
        if (!mql) return;
        if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange);
        else if (typeof mql.removeListener === 'function') mql.removeListener(onChange);
      } catch {}
    };
  }, []);
  return reduced;
}
