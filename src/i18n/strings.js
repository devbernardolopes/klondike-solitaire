import i18n from './index.js';

export const en = {
  achievementUnlocked: 'Achievement unlocked: {{name}}',
};

export function t(key, params) {
  return i18n.t(key, params);
}
