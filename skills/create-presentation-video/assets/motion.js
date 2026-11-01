"use strict";

(() => {
  let animations = [];
  let overlay;

  window.clearSceneMotion = () => {
    for (const animation of animations) animation.cancel();
    animations = [];
    if (overlay) overlay.remove();
    overlay = undefined;
  };

  window.prepareSceneMotion = async ({ animation, transition, previousFrame, fps }) => {
    window.clearSceneMotion();
    const intervals = [];
    const animate = (node, effect, delayFrames) => {
      const style = getComputedStyle(node);
      const keyframes = effect.keyframes.map((frame) => {
        const value = { ...frame };
        if (value.opacity !== undefined) value.opacity *= Number(style.opacity);
        if (value.transform && style.transform !== "none") value.transform += ` ${style.transform}`;
        return value;
      });
      const handle = node.animate(keyframes, {
        duration: effect.durationFrames * 1000 / fps,
        delay: delayFrames * 1000 / fps,
        fill: "both",
        easing: effect === transition ? "linear" : "ease-out",
      });
      handle.pause();
      handle.currentTime = 0;
      animations.push(handle);
      intervals.push({ startFrame: delayFrames, endFrame: delayFrames + effect.durationFrames });
    };
    if (animation) {
      const root = document.querySelector("#stage").firstElementChild;
      if (!root) throw new Error("Scene animation requires rendered content inside #stage.");
      const targets = animation.perItem && root.children.length ? Array.from(root.children) : [root];
      targets.forEach((node, index) => animate(node, animation,
        animation.delayFrames + index * animation.staggerFrames));
    }
    if (transition) {
      if (!previousFrame) throw new Error("A scene transition requires the previous scene's final frame.");
      overlay = document.createElement("div");
      overlay.className = "scene-transition";
      overlay.setAttribute("aria-hidden", "true");
      const bottom = Math.min(document.querySelector("#stage").getBoundingClientRect().bottom,
        document.querySelector("#captions").getBoundingClientRect().top);
      overlay.style.setProperty("--transition-height", `${bottom}px`);
      const image = document.createElement("img");
      image.src = previousFrame;
      image.alt = "";
      overlay.append(image);
      document.body.append(overlay);
      await image.decode();
      animate(overlay, transition, 0);
    }
    return { intervals, animatedTargets: animations.length };
  };

  window.seekSceneMotion = ({ frame, fps }) => {
    for (const animation of animations) animation.currentTime = frame * 1000 / fps;
  };
})();
