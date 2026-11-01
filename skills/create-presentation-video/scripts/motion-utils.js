"use strict";

const ANIMATIONS = {
  "fade-in": [{ opacity: 0 }, { opacity: 1 }],
  "slide-up": [{ opacity: 0, transform: "translateY(32px)" }, { opacity: 1, transform: "translateY(0px)" }],
  "zoom-in": [{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "scale(1)" }],
  stagger: [{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "translateY(0px)" }],
};
const TRANSITIONS = {
  fade: [{ opacity: 1 }, { opacity: 0 }],
  "wipe-left": [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 100% 0 0)" }],
  "wipe-right": [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 0 100%)" }],
};

function resolveSceneMotion(scene, fps = 30) {
  if (!Number.isSafeInteger(fps) || fps <= 0) throw new Error("Motion requires a positive integer frame rate.");
  const effect = (kind, presets, defaultSeconds) => {
    const value = scene[kind];
    if (value === undefined) return null;
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.type !== "string" ||
        (value.type !== "none" && !Object.hasOwn(presets, value.type))) {
      throw new Error(`Invalid ${kind} for scene ${scene.id}; choose none, ${Object.keys(presets).join(", ")}.`);
    }
    const allowed = ["type", "durationSeconds"];
    if (kind === "animation") allowed.push("delaySeconds");
    if (value.type === "stagger") allowed.push("staggerSeconds");
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) throw new Error(`Unknown ${kind} setting "${key}" for scene ${scene.id}.`);
    }
    const frames = (key, fallback, positive) => {
      const seconds = value[key] === undefined ? fallback : value[key];
      if (!Number.isFinite(seconds) || seconds < 0 || (positive && seconds === 0)) {
        throw new Error(`${kind}.${key} must be a finite ${positive ? "positive" : "nonnegative"} number of seconds for scene ${scene.id}.`);
      }
      const count = positive ? Math.ceil(seconds * fps) : Math.round(seconds * fps);
      if (!Number.isSafeInteger(count)) throw new Error(`Motion timing exceeds the safe frame range for scene ${scene.id}.`);
      return count;
    };
    const durationFrames = frames("durationSeconds", defaultSeconds, true);
    const delayFrames = kind === "animation" ? frames("delaySeconds", 0, false) : 0;
    const staggerFrames = value.type === "stagger" ? frames("staggerSeconds", 0.12, false) : 0;
    if (value.type === "none") return null;
    return {
      type: value.type, keyframes: presets[value.type], durationFrames, delayFrames, staggerFrames,
      perItem: value.type === "stagger",
    };
  };
  const animation = effect("animation", ANIMATIONS, 0.6);
  const transition = effect("transition", TRANSITIONS, 0.35);
  return { animation, transition, enabled: Boolean(animation || transition) };
}

function frameSegments(timing, intervals = []) {
  if (!Number.isSafeInteger(timing.frames) || timing.frames < 1 || !Array.isArray(timing.cues) || !timing.cues.length) {
    throw new Error("Frame planning requires a positive frame count and caption cues.");
  }
  for (const interval of intervals) {
    if (!interval || !Number.isSafeInteger(interval.startFrame) || !Number.isSafeInteger(interval.endFrame) ||
        interval.startFrame < 0 || interval.endFrame <= interval.startFrame || interval.endFrame > timing.frames) {
      throw new Error("Motion must fit entirely within the scene's synthesized duration.");
    }
  }
  const cues = [
    { text: "", startFrame: 0, endFrame: timing.cues[0].startFrame },
    ...timing.cues,
    { text: "", startFrame: timing.cues.at(-1).endFrame, endFrame: timing.frames },
  ];
  const segments = [];
  for (const cue of cues) {
    let frame = cue.startFrame;
    while (frame < cue.endFrame) {
      const moving = intervals.some((interval) => interval.startFrame <= frame && frame < interval.endFrame);
      const boundary = Math.min(cue.endFrame,
        ...intervals.filter((interval) => interval.startFrame > frame).map((interval) => interval.startFrame));
      const frames = moving ? 1 : boundary - frame;
      segments.push({ text: cue.text, startFrame: frame, frames });
      frame += frames;
    }
  }
  return segments;
}

function motionDescription(scene, fps = 30) {
  const motion = resolveSceneMotion(scene, fps);
  const describe = (effect) => effect
    ? `${effect.type} (${effect.durationFrames} frames; delay ${effect.delayFrames}; stagger ${effect.staggerFrames})`
    : "none";
  return `**Animation:** ${describe(motion.animation)}\n\n**Transition:** ${describe(motion.transition)}\n\n`;
}

module.exports = { ANIMATIONS, TRANSITIONS, resolveSceneMotion, frameSegments, motionDescription };
