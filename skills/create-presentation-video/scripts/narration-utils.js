"use strict";

function narrationSegments(scene, defaultVoice) {
  const validVoice = (voice) => typeof voice === "string" && voice.trim();
  if (!validVoice(defaultVoice) || (scene.voice !== undefined && !validVoice(scene.voice))) {
    throw new Error(`Invalid narration voice for scene ${scene.id}.`);
  }
  const voice = scene.voice ?? defaultVoice;
  if (typeof scene.narration === "string" && scene.narration.trim()) {
    return [{ text: scene.narration, voice }];
  }
  if (!Array.isArray(scene.narration) || !scene.narration.length) {
    throw new Error(`Missing narration for scene ${scene.id}; use nonempty text or an array of voice/text turns.`);
  }
  return scene.narration.map((turn, index) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn) ||
        typeof turn.text !== "string" || !turn.text.trim() ||
        (turn.voice !== undefined && !validVoice(turn.voice))) {
      throw new Error(`Invalid narration turn ${index + 1} for scene ${scene.id}; provide nonempty text and an optional voice.`);
    }
    for (const key of Object.keys(turn)) {
      if (!["text", "voice"].includes(key)) throw new Error(`Unknown narration setting "${key}" in scene ${scene.id}, turn ${index + 1}.`);
    }
    return { text: turn.text, voice: turn.voice ?? voice };
  });
}

function narrationVoices(storyboard) {
  const voices = new Set([storyboard.voice]);
  for (const scene of storyboard.scenes) {
    if (scene.voice !== undefined) voices.add(scene.voice);
    for (const turn of narrationSegments(scene, storyboard.voice)) voices.add(turn.voice);
  }
  return Array.from(voices);
}

function narrationMarkdown(scene, defaultVoice) {
  const turns = narrationSegments(scene, defaultVoice);
  if (typeof scene.narration === "string") {
    return (scene.voice === undefined ? "" : `**Narrator:** ${turns[0].voice}\n\n`) +
      `**Voice-over:** ${turns[0].text}\n`;
  }
  return "**Voice-over:**\n\n" +
    turns.map((turn, index) => `${index + 1}. **${turn.voice}:** ${turn.text}`).join("\n\n") + "\n";
}

module.exports = { narrationSegments, narrationVoices, narrationMarkdown };
