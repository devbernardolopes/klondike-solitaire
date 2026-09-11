import { MOTION } from './motion.js';

const lastByCard = new Map();

export function shouldPlayShakeVisual(cardId, now = Date.now()) {
  const cooldown = MOTION.shake?.cooldownMs ?? 400;
  if (!(cooldown > 0)) return true;
  const last = lastByCard.get(cardId) ?? 0;
  return now - last >= cooldown;
}

export function markShakeVisual(cardId, now = Date.now()) {
  if (cardId) lastByCard.set(cardId, now);
}

export function clearShakeThrottle(cardId) {
  if (cardId) lastByCard.delete(cardId);
  else lastByCard.clear();
}
