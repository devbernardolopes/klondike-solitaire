import { useControls } from 'leva';
import { MOTION } from './motion.js';

export function MotionDebugPanel() {
  useControls('move', {
    duration: { value: MOTION.move.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.move.duration = v) },
  });
  useControls('deal', {
    duration: { value: MOTION.deal.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.deal.duration = v) },
    stagger:  { value: MOTION.deal.stagger,  min: 0,    max: 0.2, step: 0.005, onChange: (v) => (MOTION.deal.stagger = v) },
  });
  useControls('auto', {
    duration: { value: MOTION.auto.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.auto.duration = v) },
  });
  useControls('undo', {
    duration: { value: MOTION.undo.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.undo.duration = v) },
  });
  useControls('draw', {
    duration:  { value: MOTION.draw.duration,  min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.draw.duration = v) },
    overshoot: { value: MOTION.draw.overshoot, min: 0,    max: 40, step: 1, onChange: (v) => (MOTION.draw.overshoot = v) },
  });
  useControls('autoComplete', {
    mode:       { value: MOTION.autoComplete.mode, options: ['sequential', 'overlap'], onChange: (v) => (MOTION.autoComplete.mode = v) },
    stepDelay:  { value: MOTION.autoComplete.stepDelay, min: 0, max: 1000, step: 10, onChange: (v) => (MOTION.autoComplete.stepDelay = v) },
  });
  useControls('flipCard', {
    duration: { value: MOTION.flipCard.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.flipCard.duration = v) },
  });
  useControls('win', {
    duration: { value: MOTION.win.duration, min: 0.1, max: 1.5, step: 0.01, onChange: (v) => (MOTION.win.duration = v) },
    stagger:  { value: MOTION.win.stagger,  min: 0,   max: 0.3, step: 0.01, onChange: (v) => (MOTION.win.stagger = v) },
    flyDistance: { value: MOTION.win.flyDistance, min: 200, max: 2000, step: 50, onChange: (v) => (MOTION.win.flyDistance = v) },
    bottomMargin: { value: MOTION.win.bottomMargin, min: 0, max: 100, step: 1, onChange: (v) => (MOTION.win.bottomMargin = v) },
  });
  useControls('shake', {
    duration: { value: MOTION.shake.duration, min: 0.1, max: 1.5, step: 0.01, onChange: (v) => (MOTION.shake.duration = v) },
    distance: { value: MOTION.shake.distance, min: 0, max: 30, step: 1, onChange: (v) => (MOTION.shake.distance = v) },
  });
  return null;
}
