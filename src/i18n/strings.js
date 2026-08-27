// i18n/strings.js
// Scoped, flat string table for the toast system only (this phase does NOT
// retrofit the rest of the app). Keeping toast copy here (rather than inline in
// the component) means swapping onto a real i18n library later won't touch the
// toast UI itself.

/** @type {Record<string, string>} */
export const en = {
  achievementUnlocked: 'Achievement unlocked: {name}',
};

/**
 * Resolve a message key with {param} substitution.
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
export function t(key, params) {
  let s = en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}
