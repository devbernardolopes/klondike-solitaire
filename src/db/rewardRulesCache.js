import { db } from './schema.js';

export async function getRewardRulesCache() {
  const row = await db.rewardRules.get('rules');
  return row || null;
}

export async function setRewardRulesCache(value) {
  await db.rewardRules.put({ key: 'rules', value, fetchedAt: Date.now() });
}

export async function clearRewardRulesCache() {
  await db.rewardRules.clear();
}
