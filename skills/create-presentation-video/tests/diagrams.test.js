"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { validateStoryboard, scriptMarkdown, sceneTiming } = require("../scripts/video-utils.js");
const { validateDiagram, loadDiagramSources } = require("../scripts/diagram-utils.js");
const { renderDiagrams, measureDiagram } = require("../scripts/render-diagrams.js");
const { prepareTemplate, renderFrames } = require("../scripts/generate-video.js");
const { initProject } = require("../scripts/init-project.js");
const { frameSegments } = require("../scripts/motion-utils.js");
const base = require("./fixtures/storyboard.json");
const mermaid = "flowchart LR\n A[Source files] --> B[Storyboard]\n B --> C[MP4 export]";
const svg = fs.readFileSync(path.join(__dirname, "fixtures/diagram.svg"), "utf8");
const scene = { ...base.scenes[1], id: "architecture", visual: "diagram", diagram: { type: "mermaid", source: mermaid } };
const browserTestsEnabled = process.env.VIDEO_RENDER_TEST === "1";
const renderTestsEnabled = process.platform === "darwin" && browserTestsEnabled;
const palette = {
  panel: "#0c1d2b", surface: "#142d3c", text: "#edf6fa", muted: "#b6cbd7",
  accent: "#79e9be", fontFamily: "Arial, sans-serif",
};

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "presentation diagrams & spaces "));
  const project = path.join(root, "project");
  const video = path.join(project, "video");
  const work = path.join(root, "render");
  fs.mkdirSync(path.join(video, "diagrams"), { recursive: true });
  fs.mkdirSync(work);
  fs.writeFileSync(path.join(video, "diagrams/pipeline.mmd"), mermaid);
  fs.writeFileSync(path.join(video, "diagrams/pipeline.svg"), svg);
  return { root, project, video, work };
}

function story(...scenes) {
  return { ...base, scenes: [base.scenes[0], ...scenes, base.scenes.at(-1)] };
}

test("diagram scenes accept inline Mermaid and local Mermaid/SVG files with explicit layout rules", () => {
  for (const diagram of [
    { type: "mermaid", source: mermaid }, { type: "mermaid", file: "diagrams/pipeline.mmd" },
    { type: "mermaid", file: "diagrams/pipeline.mermaid" }, { type: "svg", file: "diagrams/pipeline.svg" },
  ]) {
    validateStoryboard(story({ ...scene, diagram }));
    validateStoryboard(story({ ...scene, diagram, layout: "split", points: ["Read the source", "Export the presentation"] }));
  }
  for (const diagram of [undefined, null, [], "mermaid", {}, { type: ["mermaid"], source: mermaid },
    { type: "unknown", source: mermaid }, { type: "mermaid", source: "" },
    { type: "mermaid", source: mermaid, file: "graph.mmd" }, { type: "svg", source: svg },
    { type: "mermaid", source: mermaid, theme: "dark" }]) {
    assert.throws(() => validateDiagram({ ...scene, diagram }), /diagram|Diagram|Mermaid|SVG/);
  }
  for (const file of ["../outside.svg", "graphs/../../outside.svg", "/tmp/a.svg", "https://example.org/a.svg",
    "file:///tmp/a.svg", "C:\\private\\a.svg", "graphs\\a.svg", "a.png", "a.svg\0", ""]) {
    assert.throws(() => validateDiagram({ ...scene, diagram: { type: "svg", file } }), /video-relative/);
  }
  assert.throws(() => validateDiagram({ ...scene, layout: "split", points: [] }), /brief points/);
  assert.throws(() => validateStoryboard(story({ ...scene, layout: "cards" })), /Invalid layout/);
});

test("source resolution retains exact source and hashes, rejects escaping symlinks, and needs no media dependency", () => {
  const { root, project, video } = fixture();
  try {
    const inline = loadDiagramSources(story(scene), project);
    const fileScene = { ...scene, diagram: { type: "mermaid", file: "diagrams/pipeline.mmd" } };
    const files = loadDiagramSources(story(fileScene), project);
    assert.equal(inline.architecture.source, mermaid);
    assert.equal(files.architecture.sourceSha256, inline.architecture.sourceSha256);
    assert.equal(files.architecture.sourceFile, "video/diagrams/pipeline.mmd");
    const script = scriptMarkdown(story(fileScene), files);
    assert.match(script, /file `video\/diagrams\/pipeline.mmd`/);
    assert.ok(script.includes(`\`\`\`mermaid\n${mermaid}\n\`\`\``));
    const copy = path.join(root, "relocated skill");
    fs.cpSync(path.resolve(__dirname, ".."), copy, { recursive: true, filter: (file) => path.basename(file) !== "node_modules" });
    fs.writeFileSync(path.join(video, "storyboard.json"), JSON.stringify(story(fileScene)));
    const result = spawnSync(process.execPath, [path.join(copy, "scripts/generate-video.js"),
      "--project", project, "--script-only"], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.readFileSync(path.join(video, "SCRIPT.md"), "utf8").includes(mermaid));
    assert.equal(fs.existsSync(path.join(copy, "node_modules")), false);
    for (const source of ["", "   ", "%%{init: {'securityLevel': 'loose'}}%%\nflowchart LR\nA-->B", "---\nconfig: {}\n---\nflowchart LR\nA-->B"]) {
      assert.throws(() => loadDiagramSources(story({ ...scene, diagram: { type: "mermaid", source } }), project), /empty|source|directives/);
    }
    assert.throws(() => loadDiagramSources(story({ ...scene, diagram: { type: "svg", file: "missing.svg" } }), project), /ENOENT/);
    fs.writeFileSync(path.join(root, "outside.svg"), svg);
    fs.symlinkSync(path.join(root, "outside.svg"), path.join(video, "diagrams/outside.svg"));
    assert.throws(() => loadDiagramSources(story({ ...scene, diagram: { type: "svg", file: "diagrams/outside.svg" } }), project), /including symlink/);
    fs.mkdirSync(path.join(video, "diagrams/directory.svg"));
    assert.throws(() => loadDiagramSources(story({ ...scene, diagram: { type: "svg", file: "diagrams/directory.svg" } }), project), /not a file/);
    const fenced = scriptMarkdown(story({ ...scene, diagram: { type: "mermaid", source: "flowchart LR\n A[\"```\"] --> B" } }));
    assert.match(fenced, /````mermaid/);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("local Mermaid and SVG diagrams display in both layouts, retain sources, and support existing motion", {
  skip: !browserTestsEnabled,
  timeout: 60000,
}, async () => {
  const { root, project, work } = fixture();
  const { chromium } = require("playwright");
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const variants = [
      scene,
      { ...scene, id: "mermaid-file", diagram: { type: "mermaid", file: "diagrams/pipeline.mmd" } },
      { ...scene, id: "svg-file", layout: "split", diagram: { type: "svg", file: "diagrams/pipeline.svg" } },
      { ...scene, id: "sequence", diagram: { type: "mermaid", source: "sequenceDiagram\n Developer->>Renderer: Render the storyboard\n Renderer-->>Developer: Versioned MP4" } },
    ];
    const sources = loadDiagramSources(story(...variants), project);
    const prepared = await renderDiagrams(browser, sources, work, palette);
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const requests = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => errors.push(request.url()));
    await page.route("**/*", (route) => {
      const url = route.request().url();
      requests.push(url);
      return ["file:", "data:"].includes(new URL(url).protocol) ? route.continue() : route.abort();
    });
    const template = prepareTemplate(project, work);
    await page.goto(pathToFileURL(template).href);
    for (const value of variants) {
      for (const layout of ["default", "split"]) {
        const current = { ...value, layout, points: ["Verified project information", "Reproducible presentation exports"] };
        await page.evaluate((data) => window.renderScene(data), {
          storyboard: story(current), scene: current, index: 1, count: 3, version: 1, diagram: prepared[value.id],
        });
        const measured = await measureDiagram(page, prepared[value.id]);
        assert.ok(measured.minimumLabelPixels >= 23.99, `${value.id}/${layout}`);
        assert.equal(await page.locator("[data-diagram]").getAttribute("alt"), value.title);
        const image = page.locator("[data-diagram]");
        const clip = await image.boundingBox();
        const visible = await page.screenshot({ clip, animations: "disabled" });
        await image.evaluate((node) => { node.style.visibility = "hidden"; });
        const empty = await page.screenshot({ clip, animations: "disabled" });
        assert.ok(!visible.equals(empty), `${value.id}/${layout} must paint actual diagram pixels`);
        await image.evaluate((node) => { node.style.visibility = ""; });
        assert.equal(await page.locator("[data-diagram-notes]").count(), layout === "split" ? 1 : 0);
        if (layout === "split") assert.deepEqual(await page.locator(".diagram-notes p").allTextContents(), current.points);
        assert.ok(fs.statSync(path.join(work, prepared[value.id].metadata.svgArtifact)).size > 100);
        assert.equal(fs.readFileSync(path.join(work, prepared[value.id].metadata.sourceArtifact), "utf8"), sources[value.id].source);
      }
    }
    assert.ok(requests.every((url) => ["file:", "data:"].includes(new URL(url).protocol)));
    assert.deepEqual(errors, []);
    const motionWork = path.join(work, "motion");
    fs.mkdirSync(motionWork);
    const moving = { ...scene, animation: { type: "fade-in", durationSeconds: 0.3 },
      timing: sceneTiming(scene, 1, 30) };
    await renderFrames(browser, story(scene), [moving], { images: {}, records: {} }, motionWork, 1, template, sources);
    assert.ok(moving.motion.capturedImages > moving.timing.cues.length + 2);
    assert.ok(moving.diagramRender.minimumLabelPixels >= 24);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(root, { recursive: true });
  }
});

test("invalid, external, animated, cropped, and unreadable diagrams fail explicitly", {
  skip: !browserTestsEnabled,
  timeout: 60000,
}, async () => {
  const { root, project, video, work } = fixture();
  const { chromium } = require("playwright");
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const [index, source] of [
      "<svg><broken>",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"/>',
      svg.replace("</svg>", '<script>alert("no")</script></svg>'),
      svg.replace("</svg>", '<image href="https://example.org/image.png"/></svg>'),
      svg.replace("</svg>", '<image href="file:///private/source.png"/></svg>'),
      svg.replace("</svg>", '<image width="10" height="10" href="data:image/png;base64,bm90LWEtcG5n"/></svg>'),
      svg.replace("</svg>", "<foreignObject><div>HTML labels</div></foreignObject></svg>"),
      svg.replace("</svg>", '<animate attributeName="opacity" dur="1s"/></svg>'),
      svg.replace("</svg>", "<style>@keyframes pulse { to { opacity: 0.2; } } rect { animation: pulse 1s infinite; }</style></svg>"),
      svg.replace("</svg>", "<style>@import 'https://example.org/style.css';</style></svg>"),
      svg.replace("0 0 900 260", "0 0 10 10"),
    ].entries()) {
      const id = `invalid-${index}`;
      fs.writeFileSync(path.join(video, "diagrams/invalid.svg"), source);
      const sources = loadDiagramSources(story({ ...scene, id, diagram: { type: "svg", file: "diagrams/invalid.svg" } }), project);
      await assert.rejects(renderDiagrams(browser, sources, work, palette), /Diagram "invalid-/);
      assert.equal(fs.existsSync(path.join(work, `${id}-diagram.svg`)), false);
    }
    await assert.rejects(renderDiagrams(browser, loadDiagramSources(story({
      ...scene, diagram: { type: "mermaid", source: "not a valid Mermaid diagram" },
    }), project), work, palette), /Diagram "architecture"/);
    const dense = svg.replace('font-size="28"', 'font-size="2"');
    fs.writeFileSync(path.join(video, "diagrams/dense.svg"), dense);
    const denseScene = { ...scene, id: "dense", diagram: { type: "svg", file: "diagrams/dense.svg" },
      timing: sceneTiming(scene, 1, 30) };
    const template = prepareTemplate(project, work);
    await assert.rejects(renderFrames(browser, story(denseScene), [denseScene], { images: {}, records: {} },
      work, 1, template, loadDiagramSources(story(denseScene), project)), /minimum 24px/);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(root, { recursive: true });
  }
});

test("a relocated skill renders Mermaid and SVG into a real MP4 and preserves versioning on invalid diagrams", {
  skip: !renderTestsEnabled,
  timeout: 180000,
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "presentation diagram export "));
  const project = path.join(root, "project");
  fs.mkdirSync(project);
  try {
    const copy = path.join(root, "relocated skill");
    fs.cpSync(path.resolve(__dirname, ".."), copy, { recursive: true, filter: (file) => path.basename(file) !== "node_modules" });
    fs.mkdirSync(path.join(copy, "node_modules"));
    for (const dependency of Object.keys(require("../package.json").dependencies)) {
      fs.symlinkSync(path.dirname(require.resolve(`${dependency}/package.json`)), path.join(copy, "node_modules", dependency), "junction");
    }
    initProject({
      project, title: "Diagram example", outputName: "diagram-example", voice: "Ava (Premium)",
      duration: { minSeconds: 1, maxSeconds: 60 }, music: { enabled: false, beatsPerMinute: 104, volumeDb: -22 },
    });
    fs.mkdirSync(path.join(project, "video/diagrams"));
    fs.writeFileSync(path.join(project, "video/diagrams/pipeline.svg"), svg);
    const storyPath = path.join(project, "video/storyboard.json");
    const presentation = JSON.parse(fs.readFileSync(storyPath));
    presentation.scenes = [presentation.scenes[0],
      { ...scene, animation: { type: "fade-in", durationSeconds: 0.3 } },
      { ...scene, id: "svg-example", layout: "split", transition: { type: "wipe-left", durationSeconds: 0.3 },
        diagram: { type: "svg", file: "diagrams/pipeline.svg" } }, presentation.scenes.at(-1)];
    presentation.scenes.forEach((value) => { value.minimumSeconds = 2; value.narration = "A verified presentation workflow."; });
    fs.writeFileSync(storyPath, JSON.stringify(presentation));
    const execute = (...args) => spawnSync(process.execPath, [
      path.join(copy, "scripts/generate-video.js"), "--project", project, ...args,
    ], { encoding: "utf8", timeout: 150000 });
    assert.equal(execute("--script-only").status, 0);
    const result = execute();
    assert.equal(result.status, 0, result.stderr);
    const artifact = path.join(project, "output/diagram-example-v001");
    const report = JSON.parse(fs.readFileSync(path.join(artifact, "render.json")));
    const diagrams = report.scenes.filter((value) => value.visual === "diagram");
    assert.equal(diagrams.length, 2);
    for (const value of diagrams) {
      assert.ok(value.diagramRender.minimumLabelPixels >= 24);
      assert.ok(fs.statSync(path.join(artifact, value.diagramRender.svgArtifact)).size > 100);
      assert.ok(value.motion.enabled);
    }
    assert.ok(fs.statSync(`${artifact}.mp4`).size > 1000);
    let offsetFrames = 0;
    let imageIndex = 0;
    for (const value of report.scenes) {
      const segments = frameSegments(value.timing, value.motion.intervals);
      if (value.visual === "diagram") {
        const sample = value.timing.leadFrames + 18;
        const segment = segments.findIndex((item) => item.startFrame <= sample && sample < item.startFrame + item.frames);
        const expected = path.join(artifact, `frame-${String(imageIndex + segment + 1).padStart(4, "0")}.png`);
        const decoded = path.join(root, `${value.id}-decoded.png`);
        const ffmpeg = require("ffmpeg-static");
        const frame = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", `${artifact}.mp4`,
          "-vf", `select=eq(n\\,${offsetFrames + sample})`, "-frames:v", "1", decoded],
        { encoding: "utf8", timeout: 30000 });
        assert.equal(frame.status, 0, frame.stderr);
        const comparison = spawnSync(ffmpeg, ["-hide_banner", "-i", expected, "-i", decoded,
          "-lavfi", "psnr", "-f", "null", "-"], { encoding: "utf8", timeout: 30000 });
        assert.equal(comparison.status, 0, comparison.stderr);
        const psnr = comparison.stderr.match(/average:([\d.]+|inf)/);
        assert.ok(psnr, comparison.stderr);
        assert.ok(psnr[1] === "inf" || Number(psnr[1]) > 30, `${value.id}: the encoded diagram must match its captured slide`);
      }
      offsetFrames += value.timing.frames;
      imageIndex += segments.length;
    }
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, "video/version.json"))).nextVersion, 2);
    presentation.scenes[1].diagram.source = "not a Mermaid diagram";
    fs.writeFileSync(storyPath, JSON.stringify(presentation));
    const rejected = execute();
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Diagram "architecture"/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, "video/version.json"))).nextVersion, 2);
    assert.equal(fs.existsSync(path.join(project, ".video-render.lock")), false);
    assert.equal(fs.existsSync(path.join(project, "output/diagram-example-v002.mp4")), false);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
