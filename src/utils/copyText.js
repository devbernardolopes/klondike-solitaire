// utils/copyText.js
// Best-effort plain-text copy with a legacy fallback. navigator.clipboard
// requires a secure context and can be denied; the hidden-textarea +
// execCommand path covers those gaps (older WebViews, non-secure origins).
// All DOM access is guarded so this is import-safe under node --test (where
// it resolves false). Framework-agnostic: no React/DOM-library imports.

/**
 * Copy plain text to the clipboard.
 * @param {unknown} text  coerced to string
 * @returns {Promise<boolean>} true when the copy succeeded
 */
export async function copyText(text) {
  const str = String(text ?? '');
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(str);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    if (typeof document === 'undefined') return false;
    const area = document.createElement('textarea');
    area.value = str;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
