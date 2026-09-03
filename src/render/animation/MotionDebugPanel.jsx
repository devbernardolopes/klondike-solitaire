import { useControls } from 'leva';
import { MOTION } from './motion.js';

export function MotionDebugPanel() {
  useControls('move', {
    duration: { value: MOTION.move.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.move.duration = v) },
    stagger: { value: MOTION.move.stagger, min: 0, max: 0.2, step: 0.005, onChange: (v) => (MOTION.move.stagger = v) },
  });
  useControls('auto', {
    duration: { value: MOTION.auto.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.auto.duration = v) },
    stagger: { value: MOTION.auto.stagger, min: 0, max: 0.2, step: 0.005, onChange: (v) => (MOTION.auto.stagger = v) },
  });
  useControls('undo', {
    duration: { value: MOTION.undo.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.undo.duration = v) },
  });
  useControls('deal', {
    duration: { value: MOTION.deal.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.deal.duration = v) },
    stagger: { value: MOTION.deal.stagger, min: 0, max: 0.2, step: 0.005, onChange: (v) => (MOTION.deal.stagger = v) },
  });
  useControls('draw', {
    duration: { value: MOTION.draw.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.draw.duration = v) },
    overshoot: { value: MOTION.draw.overshoot, min: 0, max: 40, step: 1, onChange: (v) => (MOTION.draw.overshoot = v) },
  });
  useControls('autoComplete', {
    mode: { value: MOTION.autoComplete.mode, options: ['sequential', 'overlap'], onChange: (v) => (MOTION.autoComplete.mode = v) },
    stepDelay: { value: MOTION.autoComplete.stepDelay, min: 0, max: 1000, step: 10, onChange: (v) => (MOTION.autoComplete.stepDelay = v) },
  });
  useControls('flipCard', {
    duration: { value: MOTION.flipCard.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.flipCard.duration = v) },
  });
  useControls('win', {
    duration: { value: MOTION.win.duration, min: 0.1, max: 1.5, step: 0.01, onChange: (v) => (MOTION.win.duration = v) },
    stagger: { value: MOTION.win.stagger, min: 0, max: 0.3, step: 0.01, onChange: (v) => (MOTION.win.stagger = v) },
    flyDistance: { value: MOTION.win.flyDistance, min: 200, max: 2000, step: 50, onChange: (v) => (MOTION.win.flyDistance = v) },
    bottomMargin: { value: MOTION.win.bottomMargin, min: 0, max: 100, step: 1, onChange: (v) => (MOTION.win.bottomMargin = v) },
  });
  useControls('shake', {
    duration: { value: MOTION.shake.duration, min: 0.1, max: 1.5, step: 0.01, onChange: (v) => (MOTION.shake.duration = v) },
    distance: { value: MOTION.shake.distance, min: 0, max: 30, step: 1, onChange: (v) => (MOTION.shake.distance = v) },
  });
  useControls('uncover', {
    duration: { value: MOTION.uncover.duration, min: 0.1, max: 1, step: 0.01, onChange: (v) => (MOTION.uncover.duration = v) },
    radius: { value: MOTION.uncover.radius, min: 0, max: 200, step: 5, onChange: (v) => (MOTION.uncover.radius = v) },
    count: { value: MOTION.uncover.count, min: 1, max: 20, step: 1, onChange: (v) => (MOTION.uncover.count = v) },
  });
  useControls('shimmer', {
    duration: { value: MOTION.shimmer.duration, min: 0.05, max: 1.5, step: 0.01, onChange: (v) => (MOTION.shimmer.duration = v) },
  });
  useControls('hoverGlow', {
    duration: { value: MOTION.hoverGlow.duration, min: 0.2, max: 3, step: 0.05, onChange: (v) => (MOTION.hoverGlow.duration = v) },
    blur: { value: MOTION.hoverGlow.blur, min: 0, max: 40, step: 1, onChange: (v) => (MOTION.hoverGlow.blur = v) },
  });
  useControls('hoverLift', {
    duration: { value: MOTION.hoverLift.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.hoverLift.duration = v) },
    y: { value: MOTION.hoverLift.y, min: -10, max: 10, step: 0.5, onChange: (v) => (MOTION.hoverLift.y = v) },
    scale: { value: MOTION.hoverLift.scale, min: 0.95, max: 1.1, step: 0.01, onChange: (v) => (MOTION.hoverLift.scale = v) },
  });
  useControls('bounce', {
    duration: { value: MOTION.bounce.duration, min: 0.05, max: 0.6, step: 0.01, onChange: (v) => (MOTION.bounce.duration = v) },
    scale: { value: MOTION.bounce.scale, min: 1, max: 1.15, step: 0.01, onChange: (v) => (MOTION.bounce.scale = v) },
    rotation: { value: MOTION.bounce.rotation, min: 0, max: 2, step: 0.1, onChange: (v) => (MOTION.bounce.rotation = v) },
  });
  useControls('ghostEcho', {
    duration: { value: MOTION.ghostEcho.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.ghostEcho.duration = v) },
    alpha: { value: MOTION.ghostEcho.alpha, min: 0, max: 1, step: 0.01, onChange: (v) => (MOTION.ghostEcho.alpha = v) },
    scale: { value: MOTION.ghostEcho.scale, min: 0.8, max: 1.1, step: 0.01, onChange: (v) => (MOTION.ghostEcho.scale = v) },
  });
  useControls('ghostTrail', {
    duration: { value: MOTION.ghostTrail.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.ghostTrail.duration = v) },
    alpha: { value: MOTION.ghostTrail.alpha, min: 0, max: 1, step: 0.01, onChange: (v) => (MOTION.ghostTrail.alpha = v) },
    scaleStart: { value: MOTION.ghostTrail.scale.start, min: 0.8, max: 1.1, step: 0.01, onChange: (v) => (MOTION.ghostTrail.scale.start = v) },
    scaleEnd: { value: MOTION.ghostTrail.scale.end, min: 0.8, max: 1.1, step: 0.01, onChange: (v) => (MOTION.ghostTrail.scale.end = v) },
    segments: { value: MOTION.ghostTrail.segments, min: 1, max: 10, step: 1, onChange: (v) => (MOTION.ghostTrail.segments = v) },
    segmentInterval: { value: MOTION.ghostTrail.segmentInterval, min: 0, max: 0.1, step: 0.005, onChange: (v) => (MOTION.ghostTrail.segmentInterval = v) },
    maxConcurrent: { value: MOTION.ghostTrail.maxConcurrent, min: 1, max: 100, step: 1, onChange: (v) => (MOTION.ghostTrail.maxConcurrent = v) },
    dragDuration: { value: MOTION.ghostTrail.dragDuration, min: 0.05, max: 2, step: 0.01, onChange: (v) => (MOTION.ghostTrail.dragDuration = v) },
    dragSpawnIntervalMs: { value: MOTION.ghostTrail.dragSpawnIntervalMs, min: 5, max: 200, step: 5, onChange: (v) => (MOTION.ghostTrail.dragSpawnIntervalMs = v) },
  });
  useControls('boardFrame', {
    duration: { value: MOTION.boardFrame.duration, min: 0.05, max: 1.5, step: 0.01, onChange: (v) => (MOTION.boardFrame.duration = v) },
  });
  useControls('winEnhanced', {
    phase1Duration: { value: MOTION.winEnhanced.phase1.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.winEnhanced.phase1.duration = v) },
    phase2Duration: { value: MOTION.winEnhanced.phase2.duration, min: 0.1, max: 1.5, step: 0.01, onChange: (v) => (MOTION.winEnhanced.phase2.duration = v) },
  });
  useControls('confetti', {
    count: { value: MOTION.confetti.count, min: 0, max: 50, step: 1, onChange: (v) => (MOTION.confetti.count = v) },
    duration: { value: MOTION.confetti.duration, min: 0.5, max: 2, step: 0.05, onChange: (v) => (MOTION.confetti.duration = v) },
  });
  useControls('particles', {
    duration: { value: MOTION.particles.duration, min: 0.1, max: 2, step: 0.01, onChange: (v) => (MOTION.particles.duration = v) },
    radius: { value: MOTION.particles.radius, min: 20, max: 300, step: 5, onChange: (v) => (MOTION.particles.radius = v) },
    count: { value: MOTION.particles.count, min: 1, max: 30, step: 1, onChange: (v) => (MOTION.particles.count = v) },
  });
  useControls('toast', {
    slideDuration: { value: MOTION.toast.slide.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.toast.slide.duration = v) },
    fadeDuration: { value: MOTION.toast.fade.duration, min: 0.05, max: 1, step: 0.01, onChange: (v) => (MOTION.toast.fade.duration = v) },
  });
  useControls('modalEnter', {
    duration: { value: MOTION.modalEnter.duration, min: 0.1, max: 1.5, step: 0.01, onChange: (v) => (MOTION.modalEnter.duration = v) },
  });
  return null;
}
