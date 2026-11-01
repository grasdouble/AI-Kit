"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const skill = path.resolve(__dirname, "..");
const { initProject, parseOptions } = require(path.join(skill, "scripts/init-project.js"));
const { optionsFrom, validateCaptures, prepareTemplate } = require(path.join(skill, "scripts/generate-video.js"));
const { validateStoryboard, durationBounds, nextOutput } = require(path.join(skill, "scripts/video-utils.js"));
const { MUSIC_STYLES } = require(path.join(skill, "scripts/background-music.js"));
const renderTestsEnabled = process.platform === "darwin" &&
  process.env.VIDEO_RENDER_TEST === "1";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "presentation skill "));
  const project = path.join(root, "another project");
  fs.mkdirSync(project);
  return { root, project, options: { project, title: "Example project", outputName: "example-project", voice: "Ava (Premium)" } };
}

function execute(script, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8", timeout: 180000, maxBuffer: 2 * 1024 * 1024, ...options,
  });
  assert.ifError(result.error);
  return result;
}

test("skill metadata and references are portable and resolve inside the bundle", () => {
  const content = fs.readFileSync(path.join(skill, "SKILL.md"), "utf8");
  assert.match(content, /^---\nname: create-presentation-video\n/);
  assert.match(content, /description: Create or iterate/);
  assert.match(content, /macOS/);
  assert.match(content, /approve a new narrative/);
  assert.doesNotMatch(content, /\/Users\/|\/Developments\/|catalog-name:/);
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    assert.ok(fs.existsSync(path.join(skill, match[1])), `Broken bundled reference: ${match[1]}`);
  }
  const bundled = require(path.join(skill, "package.json"));
  assert.equal(bundled.scripts.test, "node --test tests/*.test.js");
  for (const dependency of ["ffmpeg-static", "playwright", "mermaid"]) {
    assert.match(bundled.dependencies[dependency], /^\d+\.\d+\.\d+$/);
  }
});

test("the invocation brief asks separately for duration, audience, installed voice, and music", () => {
  const content = fs.readFileSync(path.join(skill, "SKILL.md"), "utf8");
  for (const question of [
    "How long should the presentation be?",
    "Who is the main audience?",
    "Which narration voice would you like for the English presentation?",
    "Which musical style would you like beneath the narration, or narration only?",
  ]) assert.ok(content.includes(question), `Missing brief question: ${question}`);
  assert.match(content, /one question at a time/);
  assert.match(content, /actually installed\s+English voices/);
  assert.match(content, /Do not silently pick\s+missing preferences/);
  assert.match(content, /ask again about known choices/);
  assert.match(content, /voice change\s+must not restart the full brief/);
  assert.match(content, /before initializing a new presentation\s+or writing its narrative/);
  assert.match(content, /5-6 minutes/);
  assert.match(content, /9-10 minutes/);
  assert.match(content, /30 minutes or more/);
  assert.match(content, /no fixed maximum presentation duration/);
  for (const style of Object.keys(MUSIC_STYLES)) {
    assert.ok(content.includes(`\`${style}\``), `Missing music choice: ${style}`);
  }
});

test("initializer creates an editable starter without changing project files or overwriting video", () => {
  const { root, project, options } = fixture();
  try {
    const pkg = '{"type":"module","name":"another-project"}\n';
    fs.writeFileSync(path.join(project, "package.json"), pkg);
    initProject(options);
    const story = JSON.parse(fs.readFileSync(path.join(project, "video/storyboard.json")));
    validateStoryboard(story);
    assert.equal(story.outputName, "example-project");
    assert.equal(story.websiteUrl, undefined);
    assert.equal(story.audience, undefined);
    assert.deepEqual(story.duration, { minSeconds: 120, maxSeconds: 200 });
    assert.deepEqual(story.music, { enabled: true, beatsPerMinute: 104, volumeDb: -16 });
    assert.equal(story.scenes.at(-1).visual, "thanks");
    assert.equal(fs.readFileSync(path.join(project, "package.json"), "utf8"), pkg);
    assert.equal(fs.existsSync(path.join(project, "output")), false);
    assert.throws(() => initProject(options), /already exists/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, "video/version.json"))).nextVersion, 1);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("initializer persists every duration preset, audience, exact voice, and quiet music choice", () => {
  const { root, project } = fixture();
  try {
    for (const [preset, minSeconds, maxSeconds] of [
      ["teaser", 30, 45], ["short", 60, 90], ["standard", 120, 180],
      ["extended", 300, 360], ["deep-dive", 540, 600],
    ]) {
      for (const music of ["on", "off"]) {
        const target = path.join(project, `${preset}-${music}`);
        fs.mkdirSync(target);
        const options = parseOptions([
          "--project", target, "--title", "Configured project", "--name", "configured-project",
          "--duration", preset, "--audience", "Technical leads evaluating the architecture",
          "--voice", "Daniel (Enhanced)", "--music", music,
        ]);
        initProject(options);
        const story = JSON.parse(fs.readFileSync(path.join(target, "video/storyboard.json")));
        validateStoryboard(story);
        assert.deepEqual(story.duration, { minSeconds, maxSeconds });
        assert.equal(story.audience, "Technical leads evaluating the architecture");
        assert.equal(story.voice, "Daniel (Enhanced)");
        assert.equal(story.language, "en");
        assert.deepEqual(story.music, { enabled: music === "on", beatsPerMinute: 104, volumeDb: -22 });
        const draftSeconds = story.scenes.reduce((sum, scene) => sum + scene.minimumSeconds, 0);
        assert.ok(Math.abs(draftSeconds - minSeconds) < 0.005);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("initializer persists every musical style with its tempo and supports narration only", () => {
  const { root, project, options } = fixture();
  try {
    for (const [style, settings] of Object.entries(MUSIC_STYLES)) {
      const target = path.join(project, style);
      fs.mkdirSync(target);
      const parsed = parseOptions([
        "--project", target, "--title", options.title, "--name", options.outputName, "--voice", options.voice,
        "--duration", "extended", "--music", style,
      ]);
      initProject(parsed);
      const story = JSON.parse(fs.readFileSync(path.join(target, "video/storyboard.json")));
      validateStoryboard(story);
      assert.deepEqual(story.music, {
        enabled: true, style, beatsPerMinute: settings.beatsPerMinute, volumeDb: -22,
      });
    }
    const parsed = parseOptions([
      "--project", project, "--title", options.title, "--name", options.outputName, "--voice", options.voice,
      "--music", "none",
    ]);
    initProject(parsed);
    const story = JSON.parse(fs.readFileSync(path.join(project, "video/storyboard.json")));
    assert.deepEqual(story.music, { enabled: false, beatsPerMinute: 104, volumeDb: -22 });
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("starter section dividers stay short and share the content duration budget", () => {
  const { root, project, options } = fixture();
  try {
    for (const minSeconds of [30, 60, 119, 120, 300, 540, 1800]) {
      const target = path.join(project, String(minSeconds));
      fs.mkdirSync(target);
      initProject({ ...options, project: target, duration: { minSeconds, maxSeconds: minSeconds + 60 } });
      const story = JSON.parse(fs.readFileSync(path.join(target, "video/storyboard.json")));
      const sections = story.scenes.filter((scene) => scene.visual === "section");
      assert.equal(sections.length, minSeconds >= 120 ? 2 : 0);
      for (const section of sections) {
        assert.equal(section.minimumSeconds, 4);
        const next = story.scenes[story.scenes.indexOf(section) + 1];
        assert.equal(next.chapter, section.chapter);
        assert.notEqual(next.visual, "section");
      }
      assert.equal(story.scenes[0].visual, "title");
      assert.equal(story.scenes.at(-1).visual, "thanks");
      const total = story.scenes.reduce((seconds, scene) => seconds + scene.minimumSeconds, 0);
      assert.ok(Math.abs(total - minSeconds) < 0.005);
    }
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("section-divider guidance covers timing, existing stories, and custom templates", () => {
  const content = fs.readFileSync(path.join(skill, "SKILL.md"), "utf8");
  assert.match(content, /"visual": "section"/);
  assert.match(content, /SECTION 01 \/ 03/);
  assert.match(content, /4-6 seconds/);
  assert.match(content, /not migrated automatically/);
  assert.match(content, /Custom templates must implement the `section` visual/);
});

test("initializer accepts independent preferences and custom duration ranges without changing legacy defaults", () => {
  const { root, project, options } = fixture();
  const args = [
    "--project", project, "--title", options.title, "--name", options.outputName, "--voice", options.voice,
  ];
  try {
    assert.deepEqual(parseOptions(args), options);
    assert.deepEqual(parseOptions([...args, "--audience", "Potential users"]), {
      ...options, audience: "Potential users",
    });
    assert.deepEqual(parseOptions([...args, "--music", "off"]), {
      ...options, music: { enabled: false, beatsPerMinute: 104, volumeDb: -22 },
    });
    for (const [minSeconds, maxSeconds] of [[45, 75], [1, 200], [199.5, 200], [1740, 1860], [3600, 3660]]) {
      const target = path.join(project, String(minSeconds));
      fs.mkdirSync(target);
      const parsed = parseOptions([
        ...args, "--project", target, "--min-seconds", String(minSeconds), "--max-seconds", String(maxSeconds),
      ]);
      assert.deepEqual(parsed.duration, { minSeconds, maxSeconds });
      initProject(parsed);
      const story = JSON.parse(fs.readFileSync(path.join(target, "video/storyboard.json")));
      assert.deepEqual(story.duration, { minSeconds, maxSeconds });
      assert.equal(story.audience, undefined);
      assert.equal(story.music.volumeDb, -16);
    }
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("initializer CLI rejects invalid brief settings before writing a project", () => {
  const { root, project, options } = fixture();
  const args = [
    "--project", project, "--title", options.title, "--name", options.outputName, "--voice", options.voice,
  ];
  try {
    for (const [extra, error] of [
      [["--duration", "long"], /Choose --duration/],
      [["--duration", "toString"], /Choose --duration/],
      [["--duration", "short", "--min-seconds", "30", "--max-seconds", "60"], /without --duration/],
      [["--min-seconds", "30"], /Provide both/],
      [["--max-seconds", "60"], /Provide both/],
      [["--min-seconds", "60", "--max-seconds", "30"], /duration requires/],
      [["--min-seconds", "0", "--max-seconds", "30"], /duration requires/],
      [["--min-seconds", "NaN", "--max-seconds", "1800"], /duration requires/],
      [["--min-seconds", "words", "--max-seconds", "60"], /duration requires/],
      [["--min-seconds", "30", "--max-seconds", "Infinity"], /duration requires/],
      [["--music", "yes"], /Choose --music/],
      [["--music", "jazz"], /Choose --music/],
      [["--music", "toString"], /Choose --music/],
      [["--audience", "   "], /audience must be nonempty/],
      [["--audience"], /--audience <text>/],
      [["--unknown", "value"], /--duration/],
    ]) {
      const result = execute(path.join(skill, "scripts/init-project.js"), [...args, ...extra]);
      assert.notEqual(result.status, 0, `Accepted invalid options: ${extra.join(" ")}`);
      assert.match(result.stderr, error);
      assert.equal(fs.existsSync(path.join(project, "video")), false);
    }
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("initializer rejects invalid names before creating any project files", () => {
  const { root, project, options } = fixture();
  try {
    for (const outputName of [undefined, "", "../escape", "two words", "/absolute", "MixedCase"]) {
      assert.throws(() => initProject({ ...options, outputName }), /outputName/);
      assert.equal(fs.existsSync(path.join(project, "video")), false);
      assert.throws(() => nextOutput(project, { nextVersion: 1 }, outputName), /outputName/);
    }
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("a relocated skill initializes and exports a script without dependencies or demo-repo paths", () => {
  const { root, project } = fixture();
  try {
    const copy = path.join(root, "personal skills", "video");
    fs.cpSync(skill, copy, { recursive: true, filter: (file) => path.basename(file) !== "node_modules" });
    assert.equal(fs.existsSync(path.join(copy, "node_modules")), false);
    let result = execute(path.join(copy, "scripts/init-project.js"), [
      "--project", project, "--title", "Another project", "--name", "another-project", "--voice", "Ava (Premium)",
      "--duration", "short", "--audience", "Potential users evaluating the project", "--music", "off",
    ], { cwd: root });
    assert.equal(result.status, 0, result.stderr);
    result = execute(path.join(copy, "scripts/generate-video.js"), ["--project", project, "--script-only"], { cwd: root });
    assert.equal(result.status, 0, result.stderr);
    const markdown = fs.readFileSync(path.join(project, "video/SCRIPT.md"), "utf8");
    assert.match(markdown, /Another project/);
    assert.match(markdown, /Draft - replace/);
    assert.match(markdown, /\*\*Duration range:\*\* 60-90 seconds/);
    assert.match(markdown, /\*\*Main audience:\*\* Potential users evaluating the project/);
    assert.match(markdown, /Voice: Ava \(Premium\)/);
    assert.match(markdown, /Disabled; narration only/);
    assert.doesNotMatch(markdown, /Kiti|GitHub Pages/);
    assert.equal(fs.existsSync(path.join(project, ".video-render.lock")), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, "video/version.json"))).nextVersion, 1);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("generic options, duration bounds, and version collisions are project-specific", () => {
  assert.equal(optionsFrom([]).project, process.cwd());
  assert.equal(optionsFrom(["--project", "other", "--source", "source"]).project, path.resolve("other"));
  assert.equal(optionsFrom(["--source", "source"]).source, path.resolve("source"));
  assert.throws(() => optionsFrom(["--project"]), /incomplete/);
  assert.deepEqual(durationBounds({}), { minSeconds: 120, maxSeconds: 200 });
  for (const maxSeconds of [201, 360, 600, 1800, 36000]) {
    assert.deepEqual(durationBounds({ duration: { minSeconds: 1, maxSeconds } }), { minSeconds: 1, maxSeconds });
  }
  for (const duration of [{ minSeconds: 0, maxSeconds: 5 }, { minSeconds: 8, maxSeconds: 5 },
    { minSeconds: 1, maxSeconds: Infinity }, { minSeconds: NaN, maxSeconds: 1800 },
    { minSeconds: "1", maxSeconds: 10 }]) {
    assert.throws(() => durationBounds({ duration }), /duration requires/);
  }
  const { root, project } = fixture();
  try {
    fs.writeFileSync(path.join(project, "another-project-v001.mp4"), "existing");
    fs.mkdirSync(path.join(project, "another-project-v002"));
    assert.deepEqual(nextOutput(project, { nextVersion: 1 }, "another-project"), { version: 3, name: "another-project-v003" });
    assert.deepEqual(nextOutput(project, { nextVersion: 1 }, "independent"), { version: 1, name: "independent-v001" });
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("generic scenes reject incomplete images, points, and captured output", () => {
  const { root, project, options } = fixture();
  try {
    initProject(options);
    const story = JSON.parse(fs.readFileSync(path.join(project, "video/storyboard.json")));
    const captures = { images: {}, records: {}, provenance: {} };
    assert.throws(() => validateCaptures(story, captures), /Missing actual command/);
    captures.records["node-version"] = { display: "node --version", executable: process.execPath, arguments: ["--version"], output: process.version };
    validateCaptures(story, captures);
    const index = story.scenes.findIndex((scene) => scene.visual === "slide");
    const slide = story.scenes[index];
    story.scenes[index] = { ...slide, points: [] };
    assert.throws(() => validateStoryboard(story), /Missing slide points/);
    story.scenes[index] = { ...slide, visual: "image" };
    assert.throws(() => validateStoryboard(story), /Missing capture image key/);
    story.scenes[index].image = "home";
    validateStoryboard(story);
    assert.throws(() => validateCaptures(story, captures), /Missing captured PNG/);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("section dividers need no capture data and render with distinct, sequential title cards", {
  skip: !renderTestsEnabled,
}, async () => {
  const { chromium } = require("playwright");
  const story = structuredClone(require("./fixtures/storyboard.json"));
  const section = {
    ...story.scenes[1], id: "section-overview", visual: "section",
    title: "Explore capabilities and adopt one useful practice",
    subtitle: "Understand the options before moving into a concrete workflow.",
    minimumSeconds: 4,
  };
  story.scenes.splice(1, 0, section);
  story.scenes.splice(-1, 0,
    { ...section, id: "section-next", title: "Next steps" },
    { ...story.scenes[2], id: "next-step", title: "Try one task" },
  );
  validateStoryboard(story);
  validateCaptures(story, { records: {}, images: {}, provenance: {} });
  const { root, project } = fixture();
  const work = path.join(root, "render");
  let browser;
  try {
    fs.mkdirSync(work);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      if (["file:", "data:"].includes(new URL(route.request().url()).protocol)) return route.continue();
      errors.push(`Unexpected slide request: ${route.request().url()}`);
      return route.abort();
    });
    await page.goto(pathToFileURL(prepareTemplate(project, work)).href);
    for (const [number, index] of [1, 3].entries()) {
      await page.evaluate((data) => window.renderScene(data), {
        storyboard: story, scene: story.scenes[index], index, count: story.scenes.length,
        version: 1, websiteUrl: "https://example.org",
      });
      assert.equal(await page.locator(".section-label").textContent(), `SECTION 0${number + 1} / 02`);
      assert.equal(await page.locator(".section-card h2").textContent(), story.scenes[index].title);
      assert.equal(await page.locator(".section-card p").textContent(), story.scenes[index].subtitle);
      assert.equal(await page.locator("#stage .link").count(), 0);
      await page.evaluate(() => window.setCaption("A short narrated transition between the presentation's major parts."));
      assert.equal(await page.evaluate(() => {
        const stage = document.querySelector("#stage").getBoundingClientRect();
        return Array.from(document.querySelectorAll("#stage [data-content], #stage [data-content] > *, #captions"))
          .some((node) => {
            const bounds = node.getBoundingClientRect();
            const outside = node.closest("#stage") && (bounds.top < stage.top - 1 || bounds.bottom > stage.bottom + 1 ||
              bounds.left < stage.left - 1 || bounds.right > stage.right + 1);
            const clipped = node.matches("[data-content], #captions") &&
              (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1);
            return outside || clipped;
          });
      }), false);
    }
    await page.evaluate((data) => window.renderScene(data), {
      storyboard: story, scene: story.scenes[2], index: 2, count: story.scenes.length, version: 1,
    });
    assert.equal(await page.locator(".section-card").count(), 0);
    assert.equal(await page.locator(".point").count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(root, { recursive: true });
  }
});

test("a relocated skill renders real CLI and website evidence and preserves versions on failure", {
  skip: !renderTestsEnabled,
  timeout: 180000,
}, () => {
  const { root, project, options } = fixture();
  try {
    const copy = path.join(root, "relocated skill");
    fs.cpSync(skill, copy, { recursive: true, filter: (file) => path.basename(file) !== "node_modules" });
    fs.mkdirSync(path.join(copy, "node_modules"));
    for (const dependency of Object.keys(require("../package.json").dependencies)) {
      const installed = path.dirname(require.resolve(`${dependency}/package.json`));
      fs.symlinkSync(installed, path.join(copy, "node_modules", dependency), "junction");
    }
    initProject({
      ...options,
      audience: "Developers evaluating the project",
      duration: { minSeconds: 1, maxSeconds: 60 },
      music: { enabled: false, beatsPerMinute: 104, volumeDb: -22 },
    });

    const storyPath = path.join(project, "video/storyboard.json");
    const story = JSON.parse(fs.readFileSync(storyPath));
    story.scenes = [story.scenes[0], story.scenes[1], story.scenes[3], story.scenes[5]];
    story.scenes.forEach((scene) => { scene.minimumSeconds = 2; scene.narration = "A real project example."; });
    story.scenes.splice(2, 0, { ...story.scenes[1], id: "website", visual: "image", image: "home", title: "Local fixture app" });
    const section = {
      ...story.scenes[1], id: "section-overview", visual: "section",
      title: "Project overview", narration: "First, the project overview.", minimumSeconds: 4,
    };
    story.scenes.splice(1, 0, section);
    story.scenes.splice(-2, 0, { ...section, id: "section-demo", title: "A real demonstration", narration: "Next, a real demonstration." });
    story.duration = { minSeconds: 1, maxSeconds: 60 };
    fs.writeFileSync(storyPath, JSON.stringify(story));
    fs.copyFileSync(path.join(__dirname, "fixtures/skill-capture.cjs"), path.join(project, "video/capture.cjs"));
    const engine = path.join(copy, "scripts/generate-video.js");
    let result = execute(engine, ["--project", project], { cwd: root });
    assert.equal(result.status, 0, result.stderr);
    const artifact = path.join(project, "output/example-project-v001");
    const record = JSON.parse(fs.readFileSync(path.join(artifact, "render.json")));
    assert.equal(record.storyboard.title, "Example project");
    assert.equal(record.storyboard.audience, "Developers evaluating the project");
    assert.deepEqual(record.storyboard.duration, { minSeconds: 1, maxSeconds: 60 });
    assert.equal(record.narration.voice, options.voice);
    assert.equal(record.music.enabled, false);
    assert.equal(fs.existsSync(path.join(artifact, "background-music.wav")), false);
    assert.equal(record.commands["node-version"].output.trim(), process.version);
    assert.equal(record.capture.localFixtureVisited, true);
    assert.deepEqual(record.scenes.filter((scene) => scene.visual === "section").map((scene) => scene.id),
      ["section-overview", "section-demo"]);
    const srt = fs.readFileSync(path.join(artifact, "example-project-v001.srt"), "utf8");
    assert.match(srt, /First, the project overview\./);
    assert.match(srt, /Next, a real demonstration\./);
    assert.ok(record.media.measuredSeconds > 5 && record.media.measuredSeconds <= 60);
    assert.ok(fs.statSync(`${artifact}.mp4`).size > 1000);
    assert.ok(fs.statSync(path.join(artifact, "website-home.png")).size > 1000);
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, "video/version.json"))).nextVersion, 2);
    assert.equal(fs.existsSync(path.join(project, ".video-render.lock")), false);
    fs.writeFileSync(path.join(project, ".video-render.lock"), "existing lock");
    result = execute(engine, ["--project", project], { cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /render lock exists/);
    assert.equal(fs.readFileSync(path.join(project, ".video-render.lock"), "utf8"), "existing lock");
    fs.unlinkSync(path.join(project, ".video-render.lock"));
    fs.writeFileSync(path.join(project, "video/capture.cjs"), 'module.exports.capture = async () => { throw new Error("capture deliberately failed"); };');
    result = execute(engine, ["--project", project], { cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /capture deliberately failed/);
    assert.equal(fs.existsSync(path.join(project, ".video-render.lock")), false);
    assert.equal(fs.existsSync(path.join(project, "output/example-project-v002.mp4")), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, "video/version.json"))).nextVersion, 2);
    assert.ok(fs.statSync(`${artifact}.mp4`).size > 1000);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("a long presentation renders beyond 200 seconds with the selected musical style", {
  skip: !renderTestsEnabled,
  timeout: 300000,
}, () => {
  const { root, project, options } = fixture();
  try {
    initProject(parseOptions([
      "--project", project, "--title", options.title, "--name", options.outputName, "--voice", options.voice,
      "--min-seconds", "201", "--max-seconds", "202", "--music", "acoustic",
    ]));
    const storyPath = path.join(project, "video/storyboard.json");
    const story = JSON.parse(fs.readFileSync(storyPath));
    story.scenes = [story.scenes[0], story.scenes.at(-1)];
    story.scenes.forEach((scene) => {
      scene.minimumSeconds = 100.5;
      scene.narration = "A longer render fixture.";
    });
    fs.writeFileSync(storyPath, JSON.stringify(story));
    const result = execute(path.join(skill, "scripts/generate-video.js"), ["--project", project], { timeout: 300000 });
    assert.equal(result.status, 0, result.stderr);
    const artifact = path.join(project, "output/example-project-v001");
    const report = JSON.parse(fs.readFileSync(path.join(artifact, "render.json")));
    assert.ok(report.media.measuredSeconds >= 201 && report.media.measuredSeconds <= 202);
    assert.equal(report.music.style, "acoustic");
    assert.equal(report.music.beatsPerMinute, 96);
    assert.equal(report.music.arrangementBars, 16);
    assert.equal(fs.statSync(path.join(artifact, "background-music.wav")).size, 44 + 201 * 48000 * 4);
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, "video/version.json"))).nextVersion, 2);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
