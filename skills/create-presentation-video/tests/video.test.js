"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  validateStoryboard, validateInstalledVoice, wavDuration, captionChunks, sceneTiming, subtitles, nextOutput,
  isLocalRequest, scriptMarkdown, SCENE_LAYOUTS,
} = require("../scripts/video-utils.js");
const { optionsFrom, processingTimeout } = require("../scripts/generate-video.js");
const storyboard = require("./fixtures/storyboard.json");

test("storyboards require a narrated title, unique scene IDs, and editorial goals", () => {
  validateStoryboard(storyboard);
  assert.throws(() => validateStoryboard({ ...storyboard, scenes: storyboard.scenes.slice(1) }), /narrated title scene/);
  const duplicate = structuredClone(storyboard);
  duplicate.scenes[1].id = duplicate.scenes[0].id;
  assert.throws(() => validateStoryboard(duplicate), /duplicate/);
  const missingMessage = structuredClone(storyboard);
  delete missingMessage.scenes[1].keyMessage;
  assert.throws(() => validateStoryboard(missingMessage), /Missing keyMessage/);
  for (const narrationDirection of [undefined, "", "   ", 165]) {
    assert.throws(() => validateStoryboard({ ...storyboard, narrationDirection }), /editorial narrationDirection/);
  }
});

test("section dividers use normal scene fields and preserve the required opening title", () => {
  const configured = structuredClone(storyboard);
  const section = {
    id: "section-overview", chapter: "01 / OVERVIEW", title: "Understanding the project",
    subtitle: "The purpose and scope.", keyMessage: "Introduce the overview.",
    narration: "First, let's explore the project's purpose.", visual: "section", minimumSeconds: 4,
  };
  configured.scenes.splice(1, 0, section);
  validateStoryboard(configured);
  assert.throws(() => validateStoryboard({ ...configured, scenes: configured.scenes.slice(1) }), /narrated title scene/);
  for (const field of ["title", "subtitle", "chapter", "keyMessage", "narration"]) {
    const invalid = structuredClone(configured);
    delete invalid.scenes[1][field];
    assert.throws(() => validateStoryboard(invalid), new RegExp(`Missing ${field}`));
  }
  const timing = sceneTiming(section, 6.2, configured.fps);
  assert.equal(timing.seconds, 7.6);
  assert.equal(timing.cues[0].text, section.narration);
  assert.match(subtitles([{ timing }], configured.fps), /First, let's explore the project's purpose\./);
});

test("the main audience is optional for legacy stories and must otherwise be nonempty text", () => {
  validateStoryboard(storyboard);
  validateStoryboard({ ...storyboard, audience: "Developers and technical contributors" });
  for (const audience of ["", "   ", null, 42, false, [], {}]) {
    assert.throws(() => validateStoryboard({ ...storyboard, audience }), /audience must be nonempty/);
  }
});

test("scene layouts are optional, validated by visual, and exported in the review script", () => {
  validateStoryboard(storyboard);
  for (const [visual, layouts] of Object.entries(SCENE_LAYOUTS)) {
    for (const layout of layouts) {
      const configured = structuredClone(storyboard);
      configured.scenes[1] = {
        ...configured.scenes[1], visual, layout, image: "fixture",
        commands: ["fixture"], prompt: "Explain the project.", steps: ["Read", "Capture"],
        diagram: { type: "mermaid", source: "flowchart LR\nA[Source] --> B[Export]" },
      };
      validateStoryboard(configured);
      assert.ok(scriptMarkdown(configured).includes(`**Layout:** ${layout}`));
    }
  }
  for (const layout of ["", "unknown", "columns", "Cards", null, 42, false, [], {}]) {
    const configured = structuredClone(storyboard);
    configured.scenes[1].layout = layout;
    assert.throws(() => validateStoryboard(configured), /Invalid layout for scene/);
  }
  assert.match(scriptMarkdown(storyboard), /\*\*Layout:\*\* default/);
});

test("installed voices can narrate English content regardless of their native language", () => {
  const listing = [
    "Audrey (Premium)    fr_FR    # Bonjour, je m'appelle Audrey.",
    "Ava (Premium)       en_US    # Hello! My name is Ava.",
    "Reed (French (France)) fr_FR    # Bonjour!",
  ].join("\n");
  for (const voice of ["Audrey (Premium)", "Ava (Premium)", "Reed (French (France))"]) {
    validateInstalledVoice(voice, listing);
    validateStoryboard({ ...storyboard, language: "en", voice });
  }
  for (const voice of ["Audrey", "Audrey (Enhanced)", "Ava", "Missing (Premium)"]) {
    assert.throws(() => validateInstalledVoice(voice, listing), /not installed/);
  }
  assert.throws(() => validateInstalledVoice("Audrey (Premium)", ""), /not installed/);
  assert.throws(() => validateStoryboard({ ...storyboard, language: "fr" }), /Keep language: "en"/);
  for (const voice of ["", "   ", null, 42]) {
    assert.throws(() => validateStoryboard({ ...storyboard, voice }), /Choose a narration voice/);
  }
});

test("published websites must use HTTPS without credentials, independently of local captures", () => {
  validateStoryboard(storyboard);
  validateStoryboard({ ...storyboard, websiteUrl: "https://example.org" });
  for (const websiteUrl of ["http://localhost:4173", "https://user:password@example.org"]) {
    assert.throws(() => validateStoryboard({ ...storyboard, websiteUrl }), /HTTPS URL/);
  }
});

test("caption timing is frame-aligned, ordered, and leaves room for the full voice-over", () => {
  const scene = { ...storyboard.scenes[0], narration: "One sentence. Another sentence." };
  const timing = sceneTiming(scene, 15.017, 30);
  assert.ok(timing.seconds >= 16.417);
  assert.equal(timing.cues[0].startFrame, 12);
  assert.equal(timing.cues.at(-1).endFrame, 12 + Math.ceil(15.017 * 30));
  for (let index = 1; index < timing.cues.length; index += 1) {
    assert.equal(timing.cues[index].startFrame, timing.cues[index - 1].endFrame);
  }
  assert.equal(sceneTiming(storyboard.scenes[0], 6, 30).seconds, 8);
  assert.deepEqual(captionChunks("One short sentence. Another sentence."), ["One short sentence.", "Another sentence."]);
  assert.ok(captionChunks("word ".repeat(50)).every((caption) => caption.length <= 96));
  for (const duration of [0, -1, NaN, Infinity]) {
    assert.throws(() => sceneTiming(scene, duration, 30), /Narration cannot be empty/);
  }
});

test("subtitles offset subsequent scenes using exact frame counts", () => {
  const scene = { ...storyboard.scenes[0], narration: "Hello.", minimumSeconds: 12 };
  const timing = sceneTiming(scene, 2, 30);
  const srt = subtitles([{ timing }, { timing }], 30);
  assert.match(srt, /00:00:00,400 --> 00:00:02,400/);
  assert.match(srt, /00:00:12,400 --> 00:00:14,400/);
  assert.equal((srt.match(/Hello\./g) || []).length, 2);
  const longTiming = sceneTiming({ ...scene, minimumSeconds: 1800 }, 2, 30);
  const longSrt = subtitles([{ timing: longTiming }, { timing: longTiming }], 30);
  assert.match(longSrt, /00:30:00,400 --> 00:30:02,400/);
});

test("media-processing budgets grow with presentation duration", () => {
  assert.equal(processingTimeout(30), 300000);
  assert.equal(processingTimeout(360), 720000);
  assert.equal(processingTimeout(1800), 3600000);
  assert.equal(processingTimeout(3600), 7200000);
  assert.equal(processingTimeout(Number.MAX_VALUE), 2147483647);
});

test("WAV duration accepts PCM and rejects empty or truncated audio", () => {
  const wav = Buffer.alloc(44 + 96000);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24);
  wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(96000, 40);
  assert.equal(wavDuration(wav), 1);
  assert.throws(() => wavDuration(wav.subarray(0, 100)), /Truncated/);
  assert.throws(() => wavDuration(Buffer.alloc(44)), /RIFF/);
});

test("internal versions never select an existing MP4 or artifact directory", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-video-test-"));
  try {
    fs.writeFileSync(path.join(directory, "example-project-v001.mp4"), "");
    fs.mkdirSync(path.join(directory, "example-project-v002"));
    assert.deepEqual(nextOutput(directory, { nextVersion: 1 }, storyboard.outputName), { version: 3, name: "example-project-v003" });
    assert.throws(() => nextOutput(directory, { nextVersion: 0 }, storyboard.outputName), /positive integer/);
    assert.throws(() => nextOutput(directory, { nextVersion: "1" }, storyboard.outputName), /positive integer/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test("website captures allow only the exact local server origin", () => {
  const origin = "http://127.0.0.1:4173";
  assert.equal(isLocalRequest(`${origin}/catalog.html`, origin), true);
  for (const url of [
    "https://example.org",
    "http://127.0.0.1:4174/",
    "http://127.0.0.1.evil.example:4173/",
    "http://localhost:4173/",
  ]) assert.equal(isLocalRequest(url, origin), false);
});

test("script export preserves narration and shows editorial goals before the voice-over", () => {
  const markdown = scriptMarkdown(storyboard);
  assert.ok(markdown.includes(`**Delivery direction (editorial):** ${storyboard.narrationDirection}`));
  assert.match(markdown, /has no emotional-style setting/);
  for (const scene of storyboard.scenes) {
    const section = markdown.split(`. ${scene.title}\n\n`)[1].split("\n## ")[0];
    assert.ok(section.includes(`**Key message:** ${scene.keyMessage}`));
    assert.ok(section.includes(`**Voice-over:** ${scene.narration}`));
    assert.ok(section.indexOf("**Key message:**") < section.indexOf("**Voice-over:**"));
  }
  assert.match(markdown, /not forced word alignment/);
  assert.equal(optionsFrom(["--script-only"]).scriptOnly, true);
  assert.throws(() => optionsFrom(["--source"]), /incomplete/);
  assert.throws(() => optionsFrom(["--arbitrary-option"]), /Unknown/);
});

test("script export numbers only explicit section dividers and keeps their narration", () => {
  const configured = structuredClone(storyboard);
  const section = {
    ...configured.scenes[1], id: "section-overview", visual: "section", title: "Project overview",
    chapter: "01 / OVERVIEW", minimumSeconds: 4, narration: "First, the project overview.",
  };
  configured.scenes.splice(1, 0, section);
  configured.scenes.splice(-1, 0,
    { ...section, id: "section-next", chapter: "02 / NEXT", title: "Your next step",
      narration: "Now, let's look at the next step." },
    { ...configured.scenes[2], id: "next-step", chapter: "02 / NEXT", title: "Try one task" },
  );
  validateStoryboard(configured);
  const markdown = scriptMarkdown(configured);
  assert.equal((markdown.match(/\*\*Section divider:\*\*/g) || []).length, 2);
  assert.match(markdown, /\*\*Section divider:\*\* 01 \/ 02/);
  assert.match(markdown, /\*\*Section divider:\*\* 02 \/ 02/);
  assert.ok(markdown.indexOf("**Section divider:** 01 / 02") < markdown.indexOf(`**Voice-over:** ${section.narration}`));
  assert.doesNotMatch(scriptMarkdown(storyboard), /\*\*Section divider:\*\*/);
});

test("script export summarizes the resolved brief and rounds fractional scene clocks", () => {
  const configured = structuredClone(storyboard);
  configured.audience = "Potential users evaluating the project";
  configured.voice = "Daniel (Enhanced)";
  configured.duration = { minSeconds: 30, maxSeconds: 45 };
  configured.music = { enabled: true, beatsPerMinute: 104, volumeDb: -22 };
  configured.scenes.forEach((scene) => { scene.minimumSeconds = 10.125; });
  const markdown = scriptMarkdown(configured);
  assert.match(markdown, /\*\*Main audience:\*\* Potential users evaluating the project/);
  assert.match(markdown, /\*\*Duration range:\*\* 30-45 seconds/);
  assert.match(markdown, /Voice: Daniel \(Enhanced\)/);
  assert.match(markdown, /104 BPM; -22 dB gain/);
  assert.match(markdown, /automatically attenuated under the narration/);
  assert.match(markdown, /Target minimum: 30.375 seconds/);
  const targets = Array.from(markdown.matchAll(/\*\*Target:\*\* ([^\n]+) \|/g), ([, time]) => time);
  assert.deepEqual(targets, ["0:00-0:10", "0:10-0:20", "0:20-0:30"]);
  assert.doesNotMatch(scriptMarkdown(storyboard), /\*\*Main audience:\*\*/);
  assert.match(scriptMarkdown(storyboard), /\*\*Duration range:\*\* 120-200 seconds/);
  assert.match(scriptMarkdown({ ...configured, music: { ...configured.music, enabled: false } }), /Disabled; narration only/);
  const longScript = scriptMarkdown({
    ...configured, duration: { minSeconds: 1740, maxSeconds: 1860 },
    music: { ...configured.music, style: "ambient", beatsPerMinute: 80 },
  });
  assert.match(longScript, /\*\*Duration range:\*\* 1740-1860 seconds/);
  assert.match(longScript, /Original ambient instrumental/);
  assert.match(longScript, /80 BPM/);
});
