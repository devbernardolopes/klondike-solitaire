import { useEffect, useState } from 'react';

const QUERY = '(hover: hover) and (pointer: fine)';

export function isHoverCapable() {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia(QUERY).matches === true;
  } catch {
    return true;
  }
}

export function useHoverCapable() {
  const [capable, setCapable] = useState(isHoverCapable);
  useEffect(() => {
    let mql = null;
    let onChange = null;
    try {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
      mql = window.matchMedia(QUERY);
      onChange = (e) => setCapable(e.matches === true);
      setCapable(mql.matches === true);
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
  return capable;
}
