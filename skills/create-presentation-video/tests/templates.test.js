"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");
const { prepareTemplate } = require("../scripts/generate-video.js");
const { SCENE_LAYOUTS, validateStoryboard } = require("../scripts/video-utils.js");
const assets = path.resolve(__dirname, "../assets");
const renderTestsEnabled = process.platform === "darwin" &&
  process.env.VIDEO_RENDER_TEST === "1";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "presentation templates & spaces "));
  const project = path.join(root, "project");
  const video = path.join(project, "video");
  const work = path.join(root, "render");
  fs.mkdirSync(path.join(video, "templates"), { recursive: true });
  fs.mkdirSync(work);
  return { root, project, video, work };
}

function attributeUrl(file) {
  return pathToFileURL(file).href.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

test("the modular shell assembles shared CSS, each template's CSS, layout metadata, and the renderer", () => {
  const { root, project, video, work } = fixture();
  try {
    const template = prepareTemplate(project, work);
    const html = fs.readFileSync(template, "utf8");
    assert.equal(path.dirname(template), work);
    assert.doesNotMatch(html, /\{\{(?:BASE|STYLE|RENDERER)_URL\}\}|<!-- SCENE_(?:TEMPLATES|STYLES) -->/);
    assert.doesNotMatch(html, /<style>|<script>/);
    assert.equal((html.match(/rel="stylesheet"/g) || []).length, 8);
    for (const name of ["title", "section", "slide", "image", "terminal", "prompt", "diagram"]) {
      assert.ok(html.includes(`href="${attributeUrl(path.join(assets, `templates/${name}.css`))}"`));
    }
    const catalog = html.match(/<script id="scene-layouts" type="application\/json">([^<]+)<\/script>/);
    assert.deepEqual(JSON.parse(catalog[1]), SCENE_LAYOUTS);
    assert.ok(html.includes(`href="${attributeUrl(path.join(assets, "styles.css"))}"`));
    assert.ok(html.includes(`src="${attributeUrl(path.join(assets, "renderer.js"))}"`));
    assert.ok(html.includes(`src="${attributeUrl(path.join(assets, "motion.js"))}"`));
    const ids = Array.from(html.matchAll(/<template id="([^"]+)"/g), ([, id]) => id);
    assert.deepEqual(ids.sort(), [
      "scene-title", "scene-section", "scene-slide", "slide-point",
      "scene-image", "scene-terminal", "terminal-record", "scene-prompt", "scene-diagram",
    ].sort());
    assert.deepEqual(fs.readdirSync(video), ["templates"]);
    assert.doesNotMatch(fs.readFileSync(path.join(assets, "styles.css"), "utf8"), /\.(?:section-card|title-card|point|terminal|image|prompt)\b/);
    assert.match(fs.readFileSync(path.join(assets, "templates/section.css"), "utf8"), /\.section-card/);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("project fragment, stylesheet, renderer, and motion overrides leave other bundled fragments intact", () => {
  const { root, project, video, work } = fixture();
  try {
    const original = fs.readFileSync(path.join(assets, "templates/section.html"), "utf8");
    fs.writeFileSync(path.join(video, "templates/section.html"), original.replace("section-card", "section-card custom-section"));
    fs.copyFileSync(path.join(assets, "templates/section.css"), path.join(video, "templates/section.css"));
    fs.copyFileSync(path.join(assets, "styles.css"), path.join(video, "styles.css"));
    fs.copyFileSync(path.join(assets, "renderer.js"), path.join(video, "renderer.js"));
    fs.copyFileSync(path.join(assets, "motion.js"), path.join(video, "motion.js"));
    const html = fs.readFileSync(prepareTemplate(project, work), "utf8");
    assert.match(html, /section-card custom-section/);
    assert.match(html, /id="scene-terminal"/);
    assert.ok(html.includes(`href="${attributeUrl(path.join(video, "styles.css"))}"`));
    assert.ok(html.includes(`src="${attributeUrl(path.join(video, "renderer.js"))}"`));
    assert.ok(html.includes(`src="${attributeUrl(path.join(video, "motion.js"))}"`));
    const styles = Array.from(html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g), ([, href]) => href);
    assert.equal(styles[0], attributeUrl(path.join(assets, "styles.css")));
    assert.equal(styles.at(-1), attributeUrl(path.join(video, "styles.css")));
    assert.ok(styles.includes(attributeUrl(path.join(video, "templates/section.css"))));
    assert.ok(!styles.includes(attributeUrl(path.join(assets, "templates/section.css"))));
    assert.ok(styles.includes(attributeUrl(path.join(assets, "templates/terminal.css"))));
    assert.equal(fs.readFileSync(path.join(assets, "templates/section.html"), "utf8"), original);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("an individual CSS override needs no copied HTML or common stylesheet", () => {
  const { root, project, video, work } = fixture();
  try {
    const css = path.join(video, "templates/slide.css");
    fs.writeFileSync(css, ".points { color: gold; }\n");
    const html = fs.readFileSync(prepareTemplate(project, work), "utf8");
    assert.ok(html.includes(`href="${attributeUrl(css)}"`));
    assert.match(html, /id="scene-slide"/);
    assert.equal((html.match(/rel="stylesheet"/g) || []).length, 8);
    assert.deepEqual(fs.readdirSync(path.join(video, "templates")), ["slide.css"]);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("complete legacy custom templates are used in place without modification or new asset requirements", () => {
  const { root, project, video, work } = fixture();
  try {
    const custom = path.join(video, "template.html");
    const html = '<!doctype html><html><body><main id="stage">A full custom layout</main></body></html>\n';
    fs.writeFileSync(custom, html);
    assert.equal(prepareTemplate(project, work), custom);
    assert.equal(fs.readFileSync(custom, "utf8"), html);
    assert.deepEqual(fs.readdirSync(work), []);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("copied modular shells keep the original directory as their base for relative assets", () => {
  const { root, project, video, work } = fixture();
  try {
    fs.copyFileSync(path.join(assets, "template.html"), path.join(video, "template.html"));
    const html = fs.readFileSync(prepareTemplate(project, work), "utf8");
    assert.ok(html.includes(`<base href="${attributeUrl(`${video}${path.sep}`)}">`));
    assert.ok(html.includes(`href="${attributeUrl(path.join(assets, "styles.css"))}"`));
    assert.match(html, /id="scene-section"/);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("older modular shells without the optional scene-style marker still load every stylesheet", () => {
  const { root, project, video, work } = fixture();
  try {
    const shell = fs.readFileSync(path.join(assets, "template.html"), "utf8");
    fs.writeFileSync(path.join(video, "template.html"), shell.replace("<!-- SCENE_STYLES -->", ""));
    const html = fs.readFileSync(prepareTemplate(project, work), "utf8");
    assert.equal((html.match(/rel="stylesheet"/g) || []).length, 8);
    assert.match(html, /id="scene-layouts"/);
    assert.match(html, /id="scene-terminal"/);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("incomplete modular shells and invalid assets fail before writing the assembled presentation", () => {
  const { root, project, video, work } = fixture();
  try {
    const shell = fs.readFileSync(path.join(assets, "template.html"), "utf8");
    const custom = path.join(video, "template.html");
    fs.writeFileSync(custom, shell.replace("{{STYLE_URL}}", "styles.css"));
    assert.throws(() => prepareTemplate(project, work), /missing \{\{STYLE_URL\}\}/);
    fs.writeFileSync(custom, shell);
    fs.mkdirSync(path.join(video, "styles.css"));
    assert.throws(() => prepareTemplate(project, work), /Template asset is not a file/);
    fs.rmdirSync(path.join(video, "styles.css"));
    fs.mkdirSync(path.join(video, "templates/section.css"));
    assert.throws(() => prepareTemplate(project, work), /Template asset is not a file/);
    assert.deepEqual(fs.readdirSync(work), []);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("assembled presentations never overwrite existing render artifacts", () => {
  const { root, project, work } = fixture();
  try {
    const output = path.join(work, "presentation.html");
    fs.writeFileSync(output, "existing artifact");
    assert.throws(() => prepareTemplate(project, work), /EEXIST/);
    assert.equal(fs.readFileSync(output, "utf8"), "existing artifact");
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test("every modular visual retains its content, section counters, clipping notices, and shared styles", {
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
    await page.route("**/*", (route) => {
      if (["file:", "data:"].includes(new URL(route.request().url()).protocol)) return route.continue();
      errors.push(`Unexpected request: ${route.request().url()}`);
      return route.abort();
    });
    await page.goto(pathToFileURL(prepareTemplate(project, work)).href);
    const story = structuredClone(require("./fixtures/storyboard.json"));
    const base = story.scenes[1];
    story.scenes = [
      story.scenes[0],
      { ...base, visual: "section", id: "overview", title: "Overview" },
      { ...base, visual: "slide", id: "points", points: ["First <b>point</b>", "Second point"] },
      { ...base, visual: "section", id: "demonstration", title: "Demonstration" },
      { ...base, visual: "image", id: "capture" },
      { ...base, visual: "terminal", id: "commands" },
      { ...base, visual: "prompt", id: "prompt", prompt: "Explain <section> clearly.", steps: ["Read", "Capture"] },
      story.scenes.at(-1),
    ];
    const image = `data:image/png;base64,${(await page.screenshot()).toString("base64")}`;
    const longOutput = Array.from({ length: 20 }, (_, index) => `Line ${index + 1}`).join("\n");
    const records = [{ display: "example --list", output: longOutput }];
    for (const [index, scene] of story.scenes.entries()) {
      await page.evaluate((data) => window.renderScene(data), {
        storyboard: story, scene, index, count: story.scenes.length,
        version: 3, websiteUrl: "https://example.org", image, records,
      });
      assert.equal(await page.locator("#title").textContent(), scene.title);
      assert.equal(await page.locator("body").getAttribute("data-visual"), scene.visual);
      const isCard = ["title", "section", "thanks"].includes(scene.visual);
      assert.equal(await page.locator("body > header").isVisible(), !isCard);
      const stage = await page.locator("#stage").boundingBox();
      assert.equal(stage.y, isCard ? 38 : 210);
      assert.equal(stage.height, isCard ? 872 : 700);
      assert.equal(await page.locator("#position").textContent(), `${index + 1} / 8 - V003`);
      assert.equal(await page.locator("#stage > :not(template)").count(), 1);
      if (scene.visual === "title" || scene.visual === "thanks") {
        assert.equal(await page.locator(".title-card .link").textContent(), "https://example.org");
      } else if (scene.visual === "section") {
        assert.equal(await page.locator(".section-label").textContent(), `SECTION ${index === 1 ? "01" : "02"} / 02`);
        assert.equal(await page.locator("#stage .link").count(), 0);
      } else if (scene.visual === "slide") {
        assert.deepEqual(await page.locator(".point").allTextContents(), scene.points);
        assert.equal(await page.locator(".point b").count(), 0);
      } else if (scene.visual === "image") {
        assert.equal(await page.locator(".image").getAttribute("alt"), scene.title);
        assert.equal(await page.locator(".image").evaluate((img) => img.complete && img.naturalWidth > 0), true);
      } else if (scene.visual === "terminal") {
        assert.equal(await page.locator("pre").textContent(), longOutput.split("\n").slice(0, 15).join("\n"));
        assert.equal(await page.locator("[data-excerpt]").count(), 1);
      } else if (scene.visual === "prompt") {
        assert.equal(await page.locator("blockquote").textContent(), scene.prompt);
        assert.equal(await page.locator("[data-steps]").textContent(), "Read / Capture");
        assert.equal(await page.locator("blockquote section").count(), 0);
        assert.match(await page.locator(".prompt .notice").first().textContent(), /not a recorded assistant execution/);
      }
    }
    await page.evaluate((data) => window.renderScene(data), {
      storyboard: story, scene: story.scenes[5], index: 5, count: 8, version: 3,
      records: [records[0], { display: "second", output: longOutput }],
    });
    assert.equal(await page.locator("body > header").isVisible(), true);
    assert.equal(await page.locator("#stage").evaluate((node) => getComputedStyle(node).height), "700px");
    assert.deepEqual(await page.locator("pre").allTextContents(), Array(2).fill(longOutput.split("\n").slice(0, 7).join("\n")));
    assert.equal(await page.locator("[data-excerpt]").count(), 2);
    await page.evaluate((data) => window.renderScene(data), {
      storyboard: story, scene: story.scenes[5], index: 5, count: 8, version: 3,
      records: [{ display: "short", output: "Complete output" }],
    });
    assert.equal(await page.locator("[data-excerpt]").count(), 0);
    await page.evaluate((data) => window.renderScene(data), {
      storyboard: story, scene: story.scenes[0], index: 0, count: 8, version: 3,
    });
    assert.equal(await page.locator(".title-card .link").count(), 0);
    await page.evaluate(() => window.setCaption("An English caption."));
    assert.equal(await page.locator("#captions").textContent(), "An English caption.");
    assert.equal(await page.locator("#stage").evaluate((node) => getComputedStyle(node).height), "872px");
    assert.equal(await page.locator("#captions").evaluate((node) => getComputedStyle(node).fontSize), "30px");
    await page.locator("#scene-section").evaluate((node) => node.remove());
    await assert.rejects(page.evaluate((data) => window.renderScene(data), {
      storyboard: story, scene: story.scenes[1], index: 1, count: 8, version: 3,
    }), /Missing HTML template "#scene-section"/);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(root, { recursive: true });
  }
});

test("project HTML, per-template CSS, and global CSS overrides render locally without changing other visuals", {
  skip: !renderTestsEnabled,
}, async () => {
  const { root, project, video, work } = fixture();
  const { chromium } = require("playwright");
  let browser;
  try {
    const shell = fs.readFileSync(path.join(assets, "template.html"), "utf8");
    fs.writeFileSync(path.join(video, "template.html"), shell.replace("<!-- SCENE_STYLES -->", ""));
    const section = fs.readFileSync(path.join(assets, "templates/section.html"), "utf8");
    fs.writeFileSync(path.join(video, "templates/section.html"), section.replace("section-card", "section-card custom-section"));
    fs.writeFileSync(path.join(video, "templates/section.css"),
      `${fs.readFileSync(path.join(assets, "templates/section.css"), "utf8")}\n.custom-section { border-top-color: rgb(255, 0, 0); }\n`);
    fs.writeFileSync(path.join(video, "styles.css"), ".custom-section h2 { font-size: 77px; }\n");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.route("**/*", (route) => ["file:", "data:"].includes(new URL(route.request().url()).protocol)
      ? route.continue() : route.abort());
    await page.goto(pathToFileURL(prepareTemplate(project, work)).href);
    const story = structuredClone(require("./fixtures/storyboard.json"));
    story.scenes.splice(1, 0, { ...story.scenes[1], visual: "section", id: "overview" });
    await page.evaluate((data) => window.renderScene(data), {
      storyboard: story, scene: story.scenes[1], index: 1, count: story.scenes.length, version: 1,
    });
    assert.equal(await page.locator(".custom-section").count(), 1);
    assert.equal(await page.locator(".custom-section").evaluate((node) => getComputedStyle(node).borderTopColor), "rgb(255, 0, 0)");
    assert.equal(await page.locator(".section-label").textContent(), "SECTION 01 / 01");
    assert.equal(await page.locator(".custom-section h2").evaluate((node) => getComputedStyle(node).fontSize), "77px");
    await page.evaluate((data) => window.renderScene(data), {
      storyboard: story, scene: story.scenes[2], index: 2, count: story.scenes.length, version: 1,
    });
    assert.equal(await page.locator(".custom-section").count(), 0);
    assert.equal(await page.locator(".point").count(), 1);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(root, { recursive: true });
  }
});

test("every selectable layout renders distinct geometry without overflow or state leaking", {
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
    const base = structuredClone(require("./fixtures/storyboard.json"));
    const image = `data:image/png;base64,${(await page.screenshot()).toString("base64")}`;
    const records = [
      { display: "example --first", output: "First recorded result.\nAnother line." },
      { display: "example --second", output: "Second recorded result." },
    ];
    const points = [
      "A clear purpose grounded in actual project information.",
      "A concrete workflow with verified commands and captures.",
      "A maintainable presentation with independently styled scenes.",
      "A practical next step supported by the documentation.",
    ];
    for (const [visual, layouts] of Object.entries(SCENE_LAYOUTS)) {
      for (const layout of layouts) {
        const counts = visual === "slide" ? [1, 2, 3, 4] : visual === "terminal" ? [1, 2] : [1];
        for (const count of counts) {
          const scene = {
            ...base.scenes[1], id: "variant", visual, layout,
            title: "A maintainable project presentation",
            subtitle: "Verified information, clear explanations, and a practical next step.",
            points: points.slice(0, count), image: "fixture", commands: ["fixture"],
            diagram: { type: "mermaid", source: "flowchart LR\nA[Source] --> B[Export]" },
            prompt: "Explain this project's purpose and show one verified workflow.",
            steps: ["Read the source", "Capture the behavior", "Review the story"],
          };
          const story = { ...base, scenes: [base.scenes[0], scene, base.scenes.at(-1)] };
          validateStoryboard(story);
          await page.evaluate((data) => window.renderScene(data), {
            storyboard: story, scene, index: 1, count: 3, version: 1,
            websiteUrl: "https://example.org", image, records: records.slice(0, count),
            diagram: { image },
          });
          await page.evaluate(() => window.setCaption("An English caption remains below the presentation panel."));
          const label = `${visual}/${layout}/${count}`;
          assert.equal(await page.locator("body").getAttribute("data-layout"), layout, label);
          assert.equal(await page.locator("body > header").isVisible(), !["title", "section", "thanks"].includes(visual), label);
          const overflow = await page.evaluate(() => {
            const stage = document.querySelector("#stage").getBoundingClientRect();
            return Array.from(document.querySelectorAll("#stage *, #captions")).filter((node) => {
              const bounds = node.getBoundingClientRect();
              const outside = node.closest("#stage") && (bounds.top < stage.top - 1 ||
                bounds.bottom > stage.bottom + 1 || bounds.left < stage.left - 1 || bounds.right > stage.right + 1);
              const clipped = node.matches("[data-content], .point, #captions") &&
                (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1);
              return outside || clipped;
            }).map((node) => node.className || node.tagName);
          });
          assert.deepEqual(overflow, [], label);
          if (visual === "slide") {
            assert.deepEqual(await page.locator(".point").allTextContents(), scene.points, label);
            const boxes = await page.locator(".point").evaluateAll((nodes) =>
              nodes.map((node) => { const { x, y, height } = node.getBoundingClientRect(); return { x, y, height }; }));
            if (layout === "cards" && count >= 2) assert.ok(boxes[1].x > boxes[0].x, label);
            if (layout === "split" && count >= 2) {
              assert.ok(boxes[1].x > boxes[0].x, label);
              if (count >= 3) assert.ok(boxes[0].height > boxes[1].height, label);
            }
          } else if (["title", "thanks"].includes(visual) && layout === "left") {
            const card = await page.locator(".title-card").boundingBox();
            const title = await page.locator(".title-card h2").boundingBox();
            assert.ok(title.x - card.x < 120, label);
            assert.equal(await page.locator(".title-card").evaluate((node) => getComputedStyle(node).textAlign), "left", label);
          } else if (visual === "section" && layout === "split") {
            const number = await page.locator(".section-label").boundingBox();
            const title = await page.locator(".section-card h2").boundingBox();
            assert.ok(number.x < title.x, label);
          } else if (visual === "terminal" && layout === "columns") {
            const command = await page.locator(".command").first().boundingBox();
            const other = await page.locator(count === 1 ? "pre" : ".terminal-record").nth(count === 1 ? 0 : 1).boundingBox();
            assert.ok(other.x > command.x, label);
          } else if (visual === "prompt") {
            assert.match(await page.locator(".prompt .notice").first().textContent(), /not a recorded assistant execution/, label);
            if (layout === "split") {
              const prompt = await page.locator("blockquote").boundingBox();
              const steps = await page.locator("[data-steps]").boundingBox();
              assert.ok(steps.x > prompt.x, label);
            }
          } else if (visual === "image" && layout === "framed") {
            assert.deepEqual(await page.locator(".image").evaluate((node) => {
              const style = getComputedStyle(node);
              return { padding: style.padding, border: style.borderLeftWidth, decoded: node.complete && node.naturalWidth > 0 };
            }), { padding: "40px", border: "2px", decoded: true }, label);
          } else if (visual === "diagram") {
            assert.equal(await page.locator("[data-diagram]").getAttribute("alt"), scene.title, label);
            assert.equal(await page.locator("[data-diagram-notes]").count(), layout === "split" ? 1 : 0, label);
            if (layout === "split") assert.deepEqual(await page.locator(".diagram-notes p").allTextContents(), scene.points, label);
          }
        }
      }
    }
    const scene = { ...base.scenes[1], visual: "slide", layout: "columns" };
    await assert.rejects(page.evaluate((data) => window.renderScene(data), {
      storyboard: base, scene, index: 1, count: 3, version: 1,
    }), /Invalid layout "columns" for visual "slide"/);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(root, { recursive: true });
  }
});
