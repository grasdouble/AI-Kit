"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { narrationSegments, narrationVoices } = require("../scripts/narration-utils.js");
const { validateStoryboard, validateInstalledVoice, sceneTiming, scriptMarkdown, subtitles, wavDuration } = require("../scripts/video-utils.js");
const { narrate } = require("../scripts/generate-video.js");
const { initProject } = require("../scripts/init-project.js");
const { frameSegments } = require("../scripts/motion-utils.js");
const base = require("./fixtures/storyboard.json");
const primary = "Ava (Premium)";
const secondary = "Daniel (Enhanced)";
const renderTestsEnabled = process.platform === "darwin" &&
  process.env.VIDEO_RENDER_TEST === "1";

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "presentation voices & spaces "));
}

function dialogue() {
  return {
    ...base.scenes[1],
    narration: [
      { voice: primary, text: "A brief question." },
      { voice: secondary, text: "A brief answer." },
    ],
  };
}

function pcm(file) {
  const buffer = fs.readFileSync(file);
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4);
    if (buffer.toString("ascii", offset, offset + 4) === "data") return buffer.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  assert.fail(`Missing PCM samples: ${file}`);
}

test("voice precedence is turn, then scene, then presentation without changing legacy narration", () => {
  const scene = structuredClone(base.scenes[1]);
  assert.deepEqual(narrationSegments(scene, primary), [{ text: scene.narration, voice: primary }]);
  assert.deepEqual(narrationSegments({ ...scene, voice: secondary }, primary),
    [{ text: scene.narration, voice: secondary }]);
  const configured = {
    ...scene, voice: secondary, narration: [
      { text: "The scene voice asks a question." },
      { text: "The presentation voice answers.", voice: primary },
    ],
  };
  assert.deepEqual(narrationSegments(configured, primary).map((turn) => turn.voice), [secondary, primary]);
  delete configured.voice;
  assert.deepEqual(narrationSegments(configured, primary).map((turn) => turn.voice), [primary, primary]);
  assert.deepEqual(scene, base.scenes[1]);
  assert.deepEqual(narrationVoices({ ...base, voice: primary, scenes: [configured, dialogue()] }), [primary, secondary]);
});

test("scene overrides and narration turns reject malformed or ambiguous configuration", () => {
  const configured = { ...base, voice: primary, scenes: [base.scenes[0], dialogue(), base.scenes.at(-1)] };
  validateStoryboard(configured);
  for (const voice of [null, "", " ", false, 42, [], {}]) {
    assert.throws(() => narrationSegments({ ...dialogue(), voice }, primary), /voice/);
    assert.throws(() => narrationSegments({ ...dialogue(), narration: [{ text: "Hello.", voice }] }, primary), /turn/);
  }
  for (const narration of [undefined, null, "", "   ", false, 42, [], {}, [null], [false], ["Hello."],
    [{ text: "" }], [{ text: 3 }], [{ voice: primary }], [{ text: "Hello.", speaker: "Host" }]]) {
    assert.throws(() => validateStoryboard({
      ...configured, scenes: [base.scenes[0], { ...dialogue(), narration }],
    }), /narration/);
  }
  validateStoryboard({ ...configured, scenes: [base.scenes[0], { ...dialogue(), narration: [{ text: "One inherited voice." }] }] });
});

test("dialogue captions use measured turn samples rather than the whole scene's word counts", () => {
  const scene = { ...dialogue(), minimumSeconds: 2 };
  const turns = scene.narration.map((turn, index) => ({ ...turn, samples: index === 0 ? 38880 : 201120 }));
  const timing = sceneTiming(scene, 5, 30, turns);
  assert.equal(timing.frames, 192);
  assert.deepEqual(timing.turns, [
    { voice: primary, turnIndex: 0, startFrame: 12, endFrame: 36 },
    { voice: secondary, turnIndex: 1, startFrame: 36, endFrame: 162 },
  ]);
  assert.equal(timing.cues[1].startFrame, 36);
  assert.deepEqual(timing.cues.map((cue) => cue.voice), [primary, secondary]);
  const segments = frameSegments(timing);
  assert.equal(segments.reduce((sum, segment) => sum + segment.frames, 0), timing.frames);
  const previous = sceneTiming({ ...base.scenes[0], minimumSeconds: 12 }, 1, 30);
  const srt = subtitles([{ timing: previous }, { timing }], 30);
  assert.match(srt, /00:00:12,400 --> 00:00:13,200\nA brief question\./);
  assert.match(srt, /00:00:13,200 --> 00:00:17,400\nA brief answer\./);
  assert.doesNotMatch(srt, /Ava|Daniel/);
  assert.throws(() => sceneTiming(scene, 5, 30), /measured 48 kHz/);
  assert.throws(() => sceneTiming(scene, 6, 30, turns), /do not match/);
  assert.throws(() => sceneTiming(scene, 5, 30, turns.slice(1)), /every narration turn/);
  assert.throws(() => sceneTiming(scene, 5, 30, [{ ...turns[0], text: "Wrong text." }, turns[1]]), /every narration turn/);
  assert.throws(() => sceneTiming(scene, 48001 / 48000, 30, [{ ...turns[0], samples: 1 }, { ...turns[1], samples: 48000 }]), /too short/);
});

test("rounded dialogue boundaries remain contiguous and split captions never span two speakers", () => {
  const scene = { ...dialogue(), minimumSeconds: 2 };
  scene.narration[0].text = "First sentence. Second sentence.";
  const turns = scene.narration.map((turn) => ({ ...turn, samples: 48321 }));
  const timing = sceneTiming(scene, 96642 / 48000, 30, turns);
  assert.deepEqual(timing.cues.map((cue) => cue.turnIndex), [0, 0, 1]);
  for (let index = 1; index < timing.cues.length; index += 1) {
    assert.equal(timing.cues[index].startFrame, timing.cues[index - 1].endFrame);
  }
  assert.equal(timing.cues.at(-1).endFrame, 12 + Math.ceil(96642 / 48000 * 30));
});

test("review scripts show each applied voice and dialogue text without media dependencies", () => {
  const configured = {
    ...base, voice: primary,
    scenes: [base.scenes[0], { ...base.scenes[1], voice: secondary }, { ...dialogue(), id: "dialogue" }, base.scenes.at(-1)],
  };
  const markdown = scriptMarkdown(configured);
  assert.ok(markdown.includes(`**Narration voices:** ${primary}, ${secondary}.`));
  assert.ok(markdown.includes(`**Narrator:** ${secondary}`));
  assert.ok(markdown.includes(`1. **${primary}:** A brief question.`));
  assert.ok(markdown.includes(`2. **${secondary}:** A brief answer.`));
  assert.doesNotMatch(markdown, /\[object Object\]/);
  assert.ok(scriptMarkdown(base).includes(`**Voice-over:** ${base.scenes[1].narration}`));
  const root = fixture();
  try {
    const copy = path.join(root, "skill");
    fs.cpSync(path.resolve(__dirname, ".."), copy, { recursive: true, filter: (file) => path.basename(file) !== "node_modules" });
    fs.mkdirSync(path.join(root, "video"));
    fs.writeFileSync(path.join(root, "video/storyboard.json"), JSON.stringify(configured));
    const result = spawnSync(process.execPath, [path.join(copy, "scripts/generate-video.js"),
      "--project", root, "--script-only"], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(root, "video/SCRIPT.md"), "utf8"), markdown);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("native synthesis uses both selected voices and concatenates the exact PCM samples in turn order", {
  skip: !renderTestsEnabled,
  timeout: 60000,
}, () => {
  const root = fixture();
  try {
    const listing = spawnSync("/usr/bin/say", ["-v", "?"], { encoding: "utf8" });
    validateInstalledVoice(primary, listing.stdout);
    validateInstalledVoice(secondary, listing.stdout);
    const scene = { ...base.scenes[1], minimumSeconds: 2, narration: "Here is the project workflow." };
    const records = narrate(require("ffmpeg-static"), {
      ...base, voice: primary, scenes: [
        { ...scene, id: "default-voice" },
        { ...scene, id: "scene-voice", voice: secondary },
        { ...scene, id: "dialogue", narration: [{ text: scene.narration }, { text: scene.narration, voice: secondary }] },
      ],
    }, root);
    const first = pcm(path.join(root, "default-voice.wav"));
    const second = pcm(path.join(root, "scene-voice.wav"));
    assert.ok(!first.equals(second), "the selected voices must produce different actual audio");
    assert.ok(pcm(path.join(root, "dialogue.wav")).equals(Buffer.concat([first, second])),
      "dialogue must retain the actual voice samples, order, and native pauses without inserting per-turn padding");
    assert.deepEqual(records[2].narrationAudio.map((turn) => turn.voice), [primary, secondary]);
    assert.equal(records[2].narrationAudio.reduce((sum, turn) => sum + turn.samples, 0), (first.length + second.length) / 2);
    assert.equal(records[2].timing.turns[1].startFrame, 12 + Math.round(first.length / 2 * 30 / 48000));
    assert.equal(wavDuration(fs.readFileSync(path.join(root, "dialogue-padded.wav"))), records[2].timing.seconds);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("a two-voice MP4 supports scene overrides, dialogue, motion, and preflight rejection of missing voices", {
  skip: !renderTestsEnabled,
  timeout: 180000,
}, () => {
  const root = fixture();
  const project = path.join(root, "project");
  fs.mkdirSync(project);
  try {
    initProject({
      project, title: "Two narrators", outputName: "two-voices", voice: primary,
      duration: { minSeconds: 1, maxSeconds: 60 }, music: { enabled: false, beatsPerMinute: 104, volumeDb: -22 },
    });
    const storyPath = path.join(project, "video/storyboard.json");
    const story = JSON.parse(fs.readFileSync(storyPath));
    story.scenes = [
      { ...story.scenes[0], narration: "Welcome to this narrated example." },
      { ...base.scenes[1], voice: secondary, narration: "This scene uses a second narrator." },
      { ...dialogue(), id: "conversation", animation: { type: "fade-in", durationSeconds: 0.3 },
        transition: { type: "fade", durationSeconds: 0.3 } },
      { ...story.scenes.at(-1), narration: "Thank you for watching." },
    ];
    story.scenes.forEach((scene) => { scene.minimumSeconds = 2; });
    fs.writeFileSync(storyPath, JSON.stringify(story));
    const execute = () => spawnSync(process.execPath, [
      path.resolve(__dirname, "../scripts/generate-video.js"), "--project", project,
    ], { encoding: "utf8", timeout: 150000 });
    const result = execute();
    assert.equal(result.status, 0, result.stderr);
    const artifact = path.join(project, "output/two-voices-v001");
    const report = JSON.parse(fs.readFileSync(path.join(artifact, "render.json")));
    assert.deepEqual(report.narration.voices, [primary, secondary]);
    assert.equal(report.narration.voice, primary);
    assert.equal(report.scenes[1].narrationAudio[0].voice, secondary);
    assert.deepEqual(report.scenes[2].timing.turns.map((turn) => turn.voice), [primary, secondary]);
    const narration = fs.readFileSync(path.join(artifact, "narration.wav"));
    assert.equal(wavDuration(narration), report.scenes.reduce((sum, scene) => sum + scene.timing.frames, 0) / 30);
    const srt = fs.readFileSync(path.join(artifact, "two-voices-v001.srt"), "utf8");
    assert.equal(srt, subtitles(report.scenes, 30));
    assert.match(srt, /A brief question\./);
    assert.match(srt, /A brief answer\./);
    assert.ok(fs.statSync(`${artifact}.mp4`).size > 1000);
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, "video/version.json"))).nextVersion, 2);
    for (const missing of ["scene", "turn", "unused-scene-default"]) {
      const invalid = structuredClone(story);
      if (missing === "scene") invalid.scenes[1].voice = "Definitely not installed";
      if (missing === "turn") invalid.scenes[2].narration[1].voice = "Definitely not installed";
      if (missing === "unused-scene-default") invalid.scenes[2].voice = "Definitely not installed";
      fs.writeFileSync(storyPath, JSON.stringify(invalid));
      const rejected = execute();
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /Definitely not installed.*not installed/);
      assert.equal(JSON.parse(fs.readFileSync(path.join(project, "video/version.json"))).nextVersion, 2);
      assert.equal(fs.existsSync(path.join(project, ".video-render.lock")), false);
      assert.equal(fs.existsSync(path.join(project, "output/two-voices-v002.mp4")), false);
      assert.equal(fs.readdirSync(path.join(project, "output")).filter((file) => file.startsWith(".render-")).length, 0);
    }
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
