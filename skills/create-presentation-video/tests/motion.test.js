"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { ANIMATIONS, TRANSITIONS, resolveSceneMotion, frameSegments } = require("../scripts/motion-utils.js");
const { validateStoryboard, sceneTiming, scriptMarkdown, wavDuration } = require("../scripts/video-utils.js");
const { prepareTemplate, renderFrames } = require("../scripts/generate-video.js");
const { initProject } = require("../scripts/init-project.js");
const base = require("./fixtures/storyboard.json");
const renderTestsEnabled = process.platform === "darwin" &&
  process.env.VIDEO_RENDER_TEST === "1";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-motion-"));
  const project = path.join(root, "project");
  const work = path.join(root, "render");
  fs.mkdirSync(project);
  fs.mkdirSync(work);
  return { root, project, work };
}

test("effects are opt-in, validated strictly, and quantized to the presentation frame rate", () => {
  assert.deepEqual(resolveSceneMotion(base.scenes[0]), { animation: null, transition: null, enabled: false });
  assert.equal(resolveSceneMotion({ animation: { type: "none" }, transition: { type: "none" } }).enabled, false);
  for (const type of Object.keys(ANIMATIONS)) {
    const motion = resolveSceneMotion({ animation: { type, durationSeconds: 0.61, delaySeconds: 0.1 } });
    assert.equal(motion.animation.type, type);
    assert.equal(motion.animation.durationFrames, 19);
    assert.equal(motion.animation.delayFrames, 3);
    assert.equal(motion.enabled, true);
  }
  for (const type of Object.keys(TRANSITIONS)) {
    assert.equal(resolveSceneMotion({ transition: { type } }).transition.durationFrames, 11);
  }
  const stagger = resolveSceneMotion({ animation: { type: "stagger", staggerSeconds: 0.1 } }).animation;
  assert.equal(stagger.staggerFrames, 3);
  assert.equal(stagger.perItem, true);
  for (const kind of ["animation", "transition"]) {
    for (const value of [null, false, "fade", [], {}, { type: "unknown" }, { type: "constructor" },
      { type: "none", duration: 1 }]) {
      assert.throws(() => resolveSceneMotion({ id: "invalid", [kind]: value }), /Invalid|Unknown/);
    }
    const type = kind === "animation" ? "fade-in" : "fade";
    assert.throws(() => resolveSceneMotion({ [kind]: { type: [type] } }), /Invalid/);
    assert.throws(() => resolveSceneMotion({ [kind]: { type, staggerSeconds: 0.1 } }), /Unknown/);
    if (kind === "transition") {
      assert.throws(() => resolveSceneMotion({ [kind]: { type, delaySeconds: 0.1 } }), /Unknown/);
    }
    for (const durationSeconds of [0, -1, Infinity, NaN, "0.5", false]) {
      assert.throws(() => resolveSceneMotion({ [kind]: { type, durationSeconds } }), /seconds/);
    }
    assert.throws(() => resolveSceneMotion({ [kind]: { type, durationSeconds: 1e100 } }), /safe frame/);
  }
  for (const field of ["delaySeconds", "staggerSeconds"]) {
    assert.throws(() => resolveSceneMotion({ animation: { type: "stagger", [field]: -0.1 } }), /nonnegative/);
  }
  assert.throws(() => resolveSceneMotion({ animation: { type: "fade-in", staggerSeconds: 0.1 } }), /Unknown/);
  assert.throws(() => resolveSceneMotion({}, 0), /frame rate/);
  validateStoryboard(base);
  const story = structuredClone(base);
  story.scenes[0].transition = { type: "fade" };
  assert.throws(() => validateStoryboard(story), /opening scene cannot transition/);
  story.scenes[0].transition = { type: "none" };
  story.scenes[0].animation = { type: "zoom-in" };
  story.scenes[1].transition = { type: "wipe-left" };
  validateStoryboard(story);
  assert.match(scriptMarkdown(story), /\*\*Animation:\*\* zoom-in/);
  assert.match(scriptMarkdown(story), /\*\*Transition:\*\* wipe-left/);
  assert.match(scriptMarkdown(base), /\*\*Animation:\*\* none/);
});

test("frame planning preserves every caption and frame while sampling only moving intervals", () => {
  const timing = {
    frames: 54000,
    cues: [
      { text: "First caption.", startFrame: 12, endFrame: 24 },
      { text: "Second caption.", startFrame: 24, endFrame: 72 },
    ],
  };
  assert.deepEqual(frameSegments(timing).map(({ text, frames }) => ({ text, frames })), [
    { text: "", frames: 12 }, { text: "First caption.", frames: 12 },
    { text: "Second caption.", frames: 48 }, { text: "", frames: 53928 },
  ]);
  const intervals = [{ startFrame: 0, endFrame: 18 }, { startFrame: 21, endFrame: 30 }, { startFrame: 53970, endFrame: 53985 }];
  const segments = frameSegments(timing, intervals);
  assert.deepEqual(frameSegments(timing, [...intervals, { startFrame: 6, endFrame: 15 }]), segments);
  let elapsed = 0;
  const captionFrames = {};
  for (const segment of segments) {
    assert.equal(segment.startFrame, elapsed);
    assert.ok(segment.frames > 0);
    if (intervals.some((range) => range.startFrame < elapsed + segment.frames && range.endFrame > elapsed)) {
      assert.equal(segment.frames, 1);
    }
    captionFrames[segment.text] = (captionFrames[segment.text] || 0) + segment.frames;
    elapsed += segment.frames;
  }
  assert.equal(elapsed, timing.frames);
  assert.equal(captionFrames["First caption."], 12);
  assert.equal(captionFrames["Second caption."], 48);
  assert.ok(segments.length < 55, "a 30-minute scene must not produce 54,000 still images");
  for (const interval of [null, { startFrame: -1, endFrame: 3 }, { startFrame: 2, endFrame: 2 },
    { startFrame: 0, endFrame: 54001 }, { startFrame: 0.5, endFrame: 2 }]) {
    assert.throws(() => frameSegments(timing, [interval]), /fit entirely/);
  }
});

test("browser effects have real intermediate pixels, deterministic seeking, and clean resets", {
  skip: !renderTestsEnabled,
}, async () => {
  const { root, project, work } = fixture();
  const { chromium } = require("playwright");
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => errors.push(request.url()));
    await page.route("**/*", (route) => ["file:", "data:"].includes(new URL(route.request().url()).protocol)
      ? route.continue() : route.abort());
    await page.goto(pathToFileURL(prepareTemplate(project, work)).href);
    const scene = { ...base.scenes[1], layout: "cards", points: ["First project fact", "Second project fact", "A practical next step"] };
    const render = (value) => page.evaluate(async (data) => {
      window.clearSceneMotion();
      await window.renderScene(data);
      window.setCaption("An incoming narration caption.");
    }, { storyboard: base, scene: value, index: 1, count: 3, version: 1, records: [] });
    const shot = (clip) => page.screenshot({ animations: "allow", ...(clip ? { clip } : {}) });
    await render(scene);
    const baseline = await shot();
    await page.evaluate(() => window.clearSceneMotion());
    assert.ok(baseline.equals(await shot()), "loading the motion helper must not enable an effect");
    for (const type of Object.keys(ANIMATIONS)) {
      await render(scene);
      const options = resolveSceneMotion({ animation: { type, durationSeconds: 0.6, delaySeconds: 0.1,
        ...(type === "stagger" ? { staggerSeconds: 0.1 } : {}) } });
      const applied = await page.evaluate((options) => window.prepareSceneMotion(options), { ...options, fps: 30 });
      assert.equal(applied.animatedTargets, type === "stagger" ? 3 : 1);
      await page.evaluate(() => window.seekSceneMotion({ frame: 0, fps: 30 }));
      const start = await shot();
      await page.evaluate(() => window.seekSceneMotion({ frame: 2, fps: 30 }));
      assert.ok(start.equals(await shot()), `${type} must respect its initial delay`);
      await page.evaluate(() => window.seekSceneMotion({ frame: 9, fps: 30 }));
      const middle = await shot();
      if (type === "stagger") {
        const opacities = await page.locator("#stage > * > *").evaluateAll((nodes) =>
          nodes.map((node) => Number(getComputedStyle(node).opacity)));
        assert.ok(opacities[0] > opacities[1] && opacities[1] > opacities[2]);
      }
      const endFrame = Math.max(...applied.intervals.map((interval) => interval.endFrame));
      await page.evaluate((frame) => window.seekSceneMotion({ frame, fps: 30 }), endFrame);
      const end = await shot();
      assert.ok(!start.equals(middle) && !middle.equals(end), `${type} must visibly animate`);
      await page.evaluate(() => window.seekSceneMotion({ frame: 9, fps: 30 }));
      assert.ok(middle.equals(await shot()), `${type} seeking must not depend on wall-clock time`);
      await page.evaluate(() => window.clearSceneMotion());
      assert.ok(baseline.equals(await shot()), `${type} must restore the original layout`);
    }
    for (const type of Object.keys(TRANSITIONS)) {
      await render({ ...scene, title: "Outgoing title", points: ["A different previous scene"] });
      await page.evaluate(() => {
        window.setCaption("The previous scene's caption must not cover the incoming narration.");
        document.querySelector("#position").textContent = "Previous scene footer";
      });
      const previousFrame = `data:image/png;base64,${(await shot()).toString("base64")}`;
      const previousTop = await shot({ x: 0, y: 0, width: 1920, height: 910 });
      await render(scene);
      const incomingCaption = await shot({ x: 0, y: 930, width: 1920, height: 150 });
      const options = resolveSceneMotion({ transition: { type, durationSeconds: 0.6 } });
      await page.evaluate((options) => window.prepareSceneMotion(options), { ...options, previousFrame, fps: 30 });
      await page.evaluate(() => window.seekSceneMotion({ frame: 0, fps: 30 }));
      assert.ok(previousTop.equals(await shot({ x: 0, y: 0, width: 1920, height: 910 })), type);
      assert.ok(incomingCaption.equals(await shot({ x: 0, y: 930, width: 1920, height: 150 })), "transitions must not cover captions or the footer");
      const start = await shot();
      await page.evaluate(() => window.seekSceneMotion({ frame: 9, fps: 30 }));
      const middle = await shot();
      await page.evaluate(() => window.seekSceneMotion({ frame: 18, fps: 30 }));
      const end = await shot();
      assert.ok(!start.equals(middle) && !middle.equals(end), `${type} must visibly transition`);
      assert.ok(incomingCaption.equals(await shot({ x: 0, y: 930, width: 1920, height: 150 })));
      await page.evaluate(() => window.clearSceneMotion());
      assert.equal(await page.locator(".scene-transition").count(), 0);
      assert.ok(baseline.equals(await shot()));
    }
    const overlong = { ...scene, timing: sceneTiming({ ...scene, minimumSeconds: 1 }, 0.2, 30),
      animation: { type: "fade-in", durationSeconds: 10 } };
    await assert.rejects(renderFrames(browser, base, [overlong], { records: {}, images: {} },
      work, 1, path.join(work, "presentation.html")), /fit entirely/);
    const legacy = path.join(work, "legacy.html");
    const legacyHtml = fs.readFileSync(path.join(work, "presentation.html"), "utf8")
      .replace(/<script src="[^"]*\/motion\.js" defer><\/script>/, "");
    fs.writeFileSync(legacy, legacyHtml);
    await assert.rejects(renderFrames(browser, base, [overlong], { records: {}, images: {} },
      work, 1, legacy), /must implement window.prepareSceneMotion/);
    fs.writeFileSync(legacy, legacyHtml.replace("</body>",
      "<script>window.clearSceneMotion = () => {}; window.seekSceneMotion = () => {}; window.prepareSceneMotion = () => null;</script></body>"));
    await assert.rejects(renderFrames(browser, base, [overlong], { records: {}, images: {} },
      work, 1, legacy), /valid motion intervals and animatedTargets/);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(root, { recursive: true });
  }
});

test("an animated MP4 contains moving frames without changing narration length or subtitle offsets", {
  skip: !renderTestsEnabled,
  timeout: 180000,
}, () => {
  const { root, project } = fixture();
  try {
    initProject({
      project, title: "Example project", outputName: "motion-example", voice: "Ava (Premium)",
      duration: { minSeconds: 1, maxSeconds: 60 },
      music: { enabled: false, beatsPerMinute: 104, volumeDb: -22 },
    });
    const storyPath = path.join(project, "video/storyboard.json");
    const story = JSON.parse(fs.readFileSync(storyPath, "utf8"));
    story.scenes = [story.scenes[0], story.scenes.find((scene) => scene.visual === "terminal"), story.scenes.at(-1)];
    story.scenes.forEach((scene) => { scene.minimumSeconds = 2; scene.narration = "A real animated example."; });
    story.scenes[0].animation = { type: "fade-in" };
    story.scenes[1].transition = { type: "wipe-left" };
    story.scenes[1].animation = { type: "stagger", durationSeconds: 0.3 };
    story.scenes[2].transition = { type: "fade" };
    story.scenes[2].animation = { type: "zoom-in" };
    fs.writeFileSync(storyPath, JSON.stringify(story));
    const result = spawnSync(process.execPath, [
      path.resolve(__dirname, "../scripts/generate-video.js"), "--project", project,
    ], { encoding: "utf8", timeout: 150000 });
    assert.equal(result.status, 0, result.stderr);
    const artifact = path.join(project, "output/motion-example-v001");
    const report = JSON.parse(fs.readFileSync(path.join(artifact, "render.json"), "utf8"));
    const frames = report.scenes.reduce((sum, scene) => sum + scene.timing.frames, 0);
    assert.equal(report.media.expectedSeconds, frames / 30);
    assert.equal(wavDuration(fs.readFileSync(path.join(artifact, "narration.wav"))), frames / 30);
    assert.ok(Math.abs(report.media.measuredSeconds - frames / 30) <= 0.12);
    assert.ok(report.scenes.every((scene) => scene.motion.enabled && scene.motion.capturedImages > 10));
    const srt = fs.readFileSync(path.join(artifact, "motion-example-v001.srt"), "utf8");
    const starts = Array.from(srt.matchAll(/^(\d\d):(\d\d):(\d\d),(\d\d\d) -->/gm),
      ([, hours, minutes, seconds, milliseconds]) => ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(milliseconds));
    assert.equal(starts.length, report.scenes.length);
    let offset = 0;
    report.scenes.forEach((scene, index) => {
      assert.equal(starts[index], Math.round((offset + scene.timing.leadFrames) / 30 * 1000));
      offset += scene.timing.frames;
    });
    const ffmpeg = require("ffmpeg-static");
    const decoded = spawnSync(ffmpeg, ["-hide_banner", "-i", `${artifact}.mp4`,
      "-vf", "select='eq(n,0)+eq(n,18)',crop=1500:250:210:350,signalstats,metadata=print",
      "-an", "-f", "null", "-"], { encoding: "utf8", timeout: 30000 });
    assert.equal(decoded.status, 0, decoded.stderr);
    const brightness = Array.from(decoded.stderr.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g), ([, value]) => Number(value));
    assert.equal(brightness.length, 2);
    assert.ok(brightness[1] - brightness[0] > 1, "the encoded opening must actually fade in, not freeze at its end");
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, "video/version.json"), "utf8")).nextVersion, 2);
    assert.equal(fs.existsSync(path.join(project, ".video-render.lock")), false);
    story.scenes[0].animation.durationSeconds = 100;
    fs.writeFileSync(storyPath, JSON.stringify(story));
    const rejected = spawnSync(process.execPath, [
      path.resolve(__dirname, "../scripts/generate-video.js"), "--project", project,
    ], { encoding: "utf8", timeout: 30000 });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /fit entirely/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, "video/version.json"), "utf8")).nextVersion, 2);
    assert.equal(fs.existsSync(path.join(project, "output/motion-example-v002.mp4")), false);
    assert.ok(fs.statSync(`${artifact}.mp4`).size > 1000);
    assert.equal(fs.existsSync(path.join(project, ".video-render.lock")), false);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
