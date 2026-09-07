import { db } from './schema.js';

export async function getLimitRulesCache() {
  const row = await db.limitRules.get('rules');
  return row || null;
}

export async function setLimitRulesCache(value) {
  await db.limitRules.put({ key: 'rules', value, fetchedAt: Date.now() });
}

export async function clearLimitRulesCache() {
  await db.limitRules.clear();
}
