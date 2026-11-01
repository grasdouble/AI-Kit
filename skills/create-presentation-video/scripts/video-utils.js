"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateMusic, MUSIC_STYLES } = require("./background-music.js");
const { resolveSceneMotion, motionDescription } = require("./motion-utils.js");
const { validateDiagram, diagramDescription } = require("./diagram-utils.js");
const { narrationSegments, narrationVoices, narrationMarkdown } = require("./narration-utils.js");

const SCENE_LAYOUTS = {
  title: ["default", "left"],
  thanks: ["default", "left"],
  section: ["default", "split"],
  slide: ["default", "cards", "split"],
  terminal: ["default", "columns"],
  image: ["default", "framed"],
  diagram: ["default", "split"],
  prompt: ["default", "split"],
};

function validateStoryboard(storyboard) {
  if (typeof storyboard.title !== "string" || !storyboard.title.trim() ||
      typeof storyboard.outputName !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(storyboard.outputName)) {
    throw new Error("Choose a presentation title and a kebab-case outputName.");
  }
  if (storyboard.language !== "en") {
    throw new Error('Keep language: "en" for the presentation text and captions. Choose the narrator independently with voice.');
  }
  if (storyboard.audience !== undefined &&
      (typeof storyboard.audience !== "string" || !storyboard.audience.trim())) {
    throw new Error("audience must be nonempty text describing the main audience.");
  }
  if (!Array.isArray(storyboard.scenes) || !storyboard.scenes.length) {
    throw new Error("An English storyboard with at least one scene is required.");
  }
  if (storyboard.websiteUrl) {
    const website = new URL(storyboard.websiteUrl);
    if (website.protocol !== "https:" || website.username || website.password) {
      throw new Error("websiteUrl must be an HTTPS URL without embedded credentials.");
    }
  }
  durationBounds(storyboard);
  if (storyboard.width !== 1920 || storyboard.height !== 1080 || storyboard.fps !== 30) {
    throw new Error("The presentation must be 1920x1080 at 30 fps.");
  }
  if (!Number.isInteger(storyboard.wordsPerMinute) || storyboard.wordsPerMinute < 100 ||
      storyboard.wordsPerMinute > 200 || typeof storyboard.voice !== "string" || !storyboard.voice.trim()) {
    throw new Error("Choose a narration voice and a rate between 100 and 200 words per minute.");
  }
  if (typeof storyboard.narrationDirection !== "string" || !storyboard.narrationDirection.trim()) {
    throw new Error("Define an editorial narrationDirection separately from the spoken text.");
  }
  validateMusic(storyboard.music);
  const ids = new Set();
  const visuals = new Set(["title", "section", "slide", "image", "diagram", "distribution", "intro", "home", "search", "details", "sources", "terminal", "dashboard", "skill", "prompt", "outro", "thanks"]);
  if (storyboard.scenes[0].visual !== "title") {
    throw new Error("The presentation must open with a narrated title scene.");
  }
  for (const scene of storyboard.scenes) {
    if (!/^[a-z][a-z0-9-]*$/.test(scene.id) || ids.has(scene.id)) {
      throw new Error(`Invalid or duplicate scene ID: ${scene.id}`);
    }
    ids.add(scene.id);
    for (const key of ["chapter", "title", "subtitle", "keyMessage"]) {
      if (typeof scene[key] !== "string" || !scene[key].trim()) {
        throw new Error(`Missing ${key} for scene ${scene.id}.`);
      }
    }
    narrationSegments(scene, storyboard.voice);
    if (!visuals.has(scene.visual) || !Number.isFinite(scene.minimumSeconds) || scene.minimumSeconds <= 0) {
      throw new Error(`Invalid visual or duration for scene ${scene.id}.`);
    }
    const motion = resolveSceneMotion(scene, storyboard.fps);
    if (scene === storyboard.scenes[0] && motion.transition) {
      throw new Error("The opening scene cannot transition from a previous scene; use an entry animation instead.");
    }
    if (scene.layout !== undefined) {
      const layouts = SCENE_LAYOUTS[scene.visual];
      if (typeof scene.layout !== "string" || !/^[a-z][a-z0-9-]*$/.test(scene.layout) ||
          (layouts && !layouts.includes(scene.layout))) {
        throw new Error(`Invalid layout for scene ${scene.id} (${scene.visual}); choose ${layouts?.join(", ") || "a kebab-case layout name"}.`);
      }
    }
    if (scene.visual === "slide" && (!Array.isArray(scene.points) || !scene.points.length ||
        !scene.points.every((text) => typeof text === "string" && text.trim()))) {
      throw new Error(`Missing slide points for scene ${scene.id}.`);
    }
    if (scene.visual === "image" && (typeof scene.image !== "string" || !scene.image.trim())) {
      throw new Error(`Missing capture image key for scene ${scene.id}.`);
    }
    if (scene.visual === "diagram") validateDiagram(scene);
    if (scene.visual === "terminal" && (!Array.isArray(scene.commands) || !scene.commands.length ||
        !scene.commands.every((id) => typeof id === "string" && id.trim()))) {
      throw new Error(`Missing terminal commands for scene ${scene.id}.`);
    }
    if (scene.visual === "dashboard") {
      if (!Array.isArray(scene.features) || !scene.features.length ||
          !scene.features.every((text) => typeof text === "string" && text.trim()) ||
          !Array.isArray(scene.shortcuts) || !scene.shortcuts.length ||
          !scene.shortcuts.every((shortcut) => shortcut &&
            typeof shortcut.key === "string" && shortcut.key.trim() &&
            typeof shortcut.action === "string" && shortcut.action.trim())) {
        throw new Error(`Missing dashboard features or shortcuts for scene ${scene.id}.`);
      }
    }
    if (scene.visual === "distribution") {
      for (const key of ["resources", "repositories"]) {
        if (!Array.isArray(scene[key]) || !scene[key].length ||
            !scene[key].every((text) => typeof text === "string" && text.trim())) {
          throw new Error(`Missing distribution ${key} for scene ${scene.id}.`);
        }
      }
      if (!Array.isArray(scene.lifecycle) || !scene.lifecycle.length ||
          !scene.lifecycle.every((operation) => operation &&
            typeof operation.command === "string" && operation.command.trim() &&
            typeof operation.title === "string" && operation.title.trim())) {
        throw new Error(`Missing distribution lifecycle for scene ${scene.id}.`);
      }
    }
    if (scene.visual === "prompt" && (!scene.prompt || !Array.isArray(scene.steps) || !scene.steps.length)) {
      throw new Error(`Missing example prompt for scene ${scene.id}.`);
    }
  }
}

function durationBounds(storyboard) {
  const bounds = storyboard.duration ?? { minSeconds: 120, maxSeconds: 200 };
  if (!Number.isFinite(bounds.minSeconds) || !Number.isFinite(bounds.maxSeconds) ||
      bounds.minSeconds < 1 || bounds.minSeconds > bounds.maxSeconds) {
    throw new Error("duration requires finite numeric bounds with 1 <= minSeconds <= maxSeconds.");
  }
  return bounds;
}

function validateInstalledVoice(voice, listing) {
  const installed = listing.split("\n").some((line) => {
    const entry = line.match(/^(.+?)\s+[a-z]{2,3}_[A-Z]{2}\s+#/);
    return entry?.[1] === voice;
  });
  if (!installed) {
    throw new Error(`Narration voice "${voice}" is not installed. Run say -v '?' to list voices.`);
  }
}

function wavDuration(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Expected a RIFF/WAVE narration file.");
  }
  let byteRate;
  let dataBytes;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const name = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (offset + 8 + size > buffer.length) throw new Error("Truncated WAV chunk.");
    if (name === "fmt ") {
      if (size < 16 || buffer.readUInt16LE(offset + 8) !== 1) {
        throw new Error("Narration must use uncompressed PCM.");
      }
      byteRate = buffer.readUInt32LE(offset + 16);
    }
    if (name === "data") dataBytes = size;
    offset += 8 + size + (size % 2);
  }
  if (!byteRate || !dataBytes) throw new Error("WAV audio is empty or lacks duration metadata.");
  return dataBytes / byteRate;
}

function captionChunks(text, maxLength = 96) {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const chunks = [];
  for (const sentence of sentences) {
    let chunk = "";
    for (const word of sentence.trim().split(/\s+/)) {
      if (chunk && `${chunk} ${word}`.length > maxLength) {
        chunks.push(chunk);
        chunk = "";
      }
      chunk = chunk ? `${chunk} ${word}` : word;
    }
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function sceneTiming(scene, audioSeconds, fps, spokenTurns) {
  if (!Number.isFinite(audioSeconds) || audioSeconds <= 0) throw new Error("Narration cannot be empty.");
  const leadFrames = Math.round(0.4 * fps);
  const speechFrames = Math.ceil(audioSeconds * fps);
  const frames = Math.max(Math.ceil(scene.minimumSeconds * fps), leadFrames + speechFrames + fps);
  const dialogue = Array.isArray(scene.narration);
  let turns = [{ text: scene.narration, startFrame: leadFrames, endFrame: leadFrames + speechFrames }];
  if (dialogue) {
    if (!Array.isArray(spokenTurns) || spokenTurns.length !== scene.narration.length || !spokenTurns.length ||
        spokenTurns.some((turn, index) => !turn || !Number.isSafeInteger(turn.samples) || turn.samples <= 0 ||
          typeof turn.voice !== "string" || !turn.voice.trim() || turn.text !== scene.narration[index].text)) {
      throw new Error(`Dialogue timing needs measured 48 kHz PCM samples for every narration turn in scene ${scene.id}.`);
    }
    const totalSamples = spokenTurns.reduce((sum, turn) => sum + turn.samples, 0);
    if (!Number.isSafeInteger(totalSamples) || totalSamples !== Math.round(audioSeconds * 48000)) {
      throw new Error(`Narration turn samples do not match the complete scene audio for ${scene.id}.`);
    }
    let samples = 0;
    turns = spokenTurns.map((turn, turnIndex) => {
      const startFrame = leadFrames + Math.round(samples * fps / 48000);
      samples += turn.samples;
      const endFrame = leadFrames + (turnIndex === spokenTurns.length - 1
        ? speechFrames : Math.round(samples * fps / 48000));
      if (endFrame <= startFrame) throw new Error(`Narration turn ${turnIndex + 1} in scene ${scene.id} is too short for one video frame.`);
      return { text: turn.text, voice: turn.voice, turnIndex, startFrame, endFrame };
    });
  }
  const cues = turns.flatMap((turn) => {
    const captions = captionChunks(turn.text);
    const totalWords = captions.reduce((sum, text) => sum + text.split(/\s+/).length, 0);
    let words = 0;
    return captions.map((text) => {
      const startFrame = turn.startFrame + Math.round((turn.endFrame - turn.startFrame) * words / totalWords);
      words += text.split(/\s+/).length;
      const endFrame = turn.startFrame + Math.round((turn.endFrame - turn.startFrame) * words / totalWords);
      return { text, startFrame, endFrame, ...(dialogue ? { voice: turn.voice, turnIndex: turn.turnIndex } : {}) };
    });
  });
  return {
    frames, seconds: frames / fps, leadFrames, cues,
    ...(dialogue ? { turns: turns.map(({ text, ...timing }) => timing) } : {}),
  };
}

function timestamp(seconds) {
  const total = Math.round(seconds * 1000);
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor(total / 60000) % 60;
  const secs = Math.floor(total / 1000) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:` +
    `${String(secs).padStart(2, "0")},${String(total % 1000).padStart(3, "0")}`;
}

function subtitles(scenes, fps) {
  let offsetFrames = 0;
  let index = 0;
  const entries = [];
  for (const scene of scenes) {
    for (const cue of scene.timing.cues) {
      entries.push(`${++index}\n${timestamp((offsetFrames + cue.startFrame) / fps)} --> ` +
        `${timestamp((offsetFrames + cue.endFrame) / fps)}\n${cue.text}\n`);
    }
    offsetFrames += scene.timing.frames;
  }
  return entries.join("\n");
}

function nextOutput(outputRoot, state, outputName) {
  if (typeof outputName !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(outputName)) {
    throw new Error("Choose a kebab-case outputName.");
  }
  if (!Number.isSafeInteger(state.nextVersion) || state.nextVersion < 1) {
    throw new Error("video/version.json must contain a positive integer nextVersion.");
  }
  let version = state.nextVersion;
  while (true) {
    const name = `${outputName}-v${String(version).padStart(3, "0")}`;
    if (!fs.existsSync(path.join(outputRoot, `${name}.mp4`)) && !fs.existsSync(path.join(outputRoot, name))) {
      return { version, name };
    }
    version += 1;
    if (!Number.isSafeInteger(version)) throw new Error("Video version counter is exhausted.");
  }
}

function isLocalRequest(url, origin) {
  return new URL(url).origin === origin;
}

function scriptMarkdown(storyboard, diagramSources = {}) {
  let seconds = 0;
  let sectionNumber = 0;
  const sectionCount = storyboard.scenes.filter((scene) => scene.visual === "section").length;
  const voices = narrationVoices(storyboard);
  const { minSeconds, maxSeconds } = durationBounds(storyboard);
  const music = storyboard.music?.enabled
    ? `**Background music:** Original ${MUSIC_STYLES[storyboard.music.style ?? "electronic"].label} instrumental, synthesized locally at ` +
      `${storyboard.music.beatsPerMinute} BPM; ${storyboard.music.volumeDb} dB gain, ` +
      `automatically attenuated under the narration, with opening and closing fades. No vocals or external recording.\n\n`
    : "**Background music:** Disabled; narration only.\n\n";
  const sections = storyboard.scenes.map((scene, index) => {
    const start = seconds;
    seconds += scene.minimumSeconds;
    const clock = (value) => {
      const rounded = Math.round(value);
      return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
    };
    const prompt = scene.prompt ? `\n**Example prompt:**\n\n> ${scene.prompt}\n` : "";
    const distribution = scene.visual === "distribution"
      ? `\n**Diagram:** ${storyboard.title} -> ${scene.repositories.join(" / ")}\n\n` +
        `**Resources:** ${scene.resources.join(", ")}\n\n` +
        `**Lifecycle:** ${scene.lifecycle.map(({ command, title }) => `${command}: ${title}`).join(" / ")}\n`
      : "";
    const dashboard = scene.visual === "dashboard"
      ? (scene.command ? `\n**Command:** \`${scene.command}\`\n` : "") +
        `\n**Overview:** ${scene.features.join(" / ")}\n\n` +
        `**Keyboard actions:** ${scene.shortcuts.map(({ key, action }) => `${key}: ${action}`).join(" / ")}\n\n` +
        `**Capture:** Actual inventory and filtered dashboard states; no mutation is confirmed.\n`
      : "";
    const divider = scene.visual === "section"
      ? `**Section divider:** ${String(++sectionNumber).padStart(2, "0")} / ${String(sectionCount).padStart(2, "0")}\n\n`
      : "";
    return `## ${String(index + 1).padStart(2, "0")}. ${scene.title}\n\n` +
      `**Target:** ${clock(start)}-${clock(seconds)} | **Visual:** ${scene.visual}\n\n` +
      `**Layout:** ${scene.layout ?? "default"}\n\n` +
      motionDescription(scene, storyboard.fps) +
      divider +
      `**Key message:** ${scene.keyMessage}\n\n` +
      `**On screen:** ${scene.chapter} / ${scene.subtitle}\n\n` +
      narrationMarkdown(scene, storyboard.voice) +
      `${distribution}${dashboard}${prompt}${diagramDescription(scene, diagramSources)}` +
      (scene.points ? `\n**Talking points:** ${scene.points.join(" / ")}\n` : "");
  });
  return `# ${storyboard.title} - video script\n\n` +
    `English narration and embedded English captions. 16:9, 1080p, 30 fps.\n` +
    `Voice: ${storyboard.voice}; ${storyboard.wordsPerMinute} words per minute. ` +
    `Target minimum: ${Number(seconds.toFixed(3))} seconds; final timing follows synthesized audio.\n\n` +
    (voices.length > 1 ? `**Narration voices:** ${voices.join(", ")}.\n\n` : "") +
    `**Duration range:** ${minSeconds}-${maxSeconds} seconds; checked after narration synthesis.\n\n` +
    (storyboard.audience ? `**Main audience:** ${storyboard.audience}\n\n` : "") +
    `**Delivery direction (editorial):** ${storyboard.narrationDirection}\n\n` +
    `macOS \`say\` has no emotional-style setting. This direction guides the writing; ` +
    `delivery relies on the spoken text, punctuation, and configured speech rate. ` +
    `The direction itself is not spoken or included in captions.\n\n` +
    music +
    `Generated from \`video/storyboard.json\` with the presentation-video skill's \`--script-only\` command. Edit the JSON, not this file.\n\n` +
    (storyboard.websiteUrl ? `**Website:** [${storyboard.websiteUrl}](${storyboard.websiteUrl})\n\n` : "") +
    `Capture behavior is defined by the project's \`video/capture.cjs\` adapter. ` +
    `Local serving for recording does not imply that users must run the product locally. ` +
    `Assistant prompts must be explicitly illustrative unless an actual execution is captured. ` +
    `Caption timing is estimated from word counts, not forced word alignment.\n\n${sections.join("\n")}`;
}

module.exports = {
  validateStoryboard, validateInstalledVoice, durationBounds, wavDuration, captionChunks, sceneTiming, subtitles, nextOutput,
  isLocalRequest, scriptMarkdown,
  SCENE_LAYOUTS,
};
