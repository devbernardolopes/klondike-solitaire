// audio/synth/envelope.js
// Shared AD-ish envelope for tone + noise sfx. Linear attack ramp to `peak`,
// then an exponential ramp down to a near-zero target so the tail is inaudible
// but the node still terminates cleanly when the caller stops the source.
//
// The exponential target uses `0.0001` rather than `0` because setTargetAtTime
// with a zero target is interpreted by Web Audio as a no-op (it cannot ramp
// toward negative values, and the spec forbids it). 0.0001 is the
// conventionally-recommended floor — audibly silent but ramps cleanly.

/**
 * Apply a simple attack/decay envelope to a GainNode. Schedules relative to
 * ctx.currentTime so the envelope starts immediately when called.
 * @param {GainNode} gainNode
 * @param {AudioContext} ctx
 * @param {{attack?: number, decay?: number, peak?: number}} [opts]
 */
export function applyEnvelope(gainNode, ctx, { attack = 0.005, decay = 0.15, peak = 1 } = {}) {
  const a = Math.max(0, Number(attack) || 0);
  const d = Math.max(0.001, Number(decay) || 0.15);
  const p = Math.max(0, Number(peak) || 0);
  const now = ctx.currentTime;
  try {
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(p, now + a);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + a + d);
  } catch {}
}