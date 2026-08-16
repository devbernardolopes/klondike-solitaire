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
