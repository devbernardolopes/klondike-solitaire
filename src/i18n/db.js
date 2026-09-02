import i18n from './index.js';

export function tDb(namespace, id, field, fallback) {
  const key = `db.${namespace}.${id}.${field}`;
  const v = i18n.t(key, { defaultValue: fallback ?? '' });
  if (v === key) return fallback ?? '';
  return v;
}

export function translateAchievement(row) {
  if (!row) return row;
  return {
    ...row,
    name: tDb('achievements', row.id, 'name', row.name),
    description: tDb('achievements', row.id, 'description', row.description),
  };
}

export function translateStoreItem(row) {
  if (!row) return row;
  return {
    ...row,
    name: tDb('storeItems', row.id, 'name', row.name),
    description: tDb('storeItems', row.id, 'description', row.description),
  };
}

export function translateSpecialEvent(row) {
  if (!row) return row;
  return {
    ...row,
    title: tDb('specialEvents', row.id, 'title', row.title),
    description: tDb('specialEvents', row.id, 'description', row.description),
  };
}
