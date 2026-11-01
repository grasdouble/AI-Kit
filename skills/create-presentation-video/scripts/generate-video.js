"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const {
  validateStoryboard, validateInstalledVoice, durationBounds, wavDuration, sceneTiming, subtitles, nextOutput, isLocalRequest, scriptMarkdown, SCENE_LAYOUTS,
} = require("./video-utils.js");
const { writeBackgroundMusic, soundtrackFilter } = require("./background-music.js");
const { resolveSceneMotion, frameSegments } = require("./motion-utils.js");
const { loadDiagramSources } = require("./diagram-utils.js");
const { renderDiagrams, measureDiagram } = require("./render-diagrams.js");
const { narrationSegments, narrationVoices } = require("./narration-utils.js");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || result.stdout?.trim() ||
      `exit ${result.status}, signal ${result.signal}`;
    throw new Error(`${path.basename(command)} failed: ${detail.slice(-6000)}`);
  }
  return result;
}

function processingTimeout(seconds) {
  return Math.min(2147483647, Math.max(300000, Math.ceil(seconds * 2000)));
}

function prepareTemplate(projectRoot, work) {
  const assets = path.join(__dirname, "../assets");
  const video = path.resolve(projectRoot, "video");
  const custom = path.join(video, "template.html");
  const source = fs.existsSync(custom) ? custom : path.join(assets, "template.html");
  let html = fs.readFileSync(source, "utf8");
  const marker = "<!-- SCENE_TEMPLATES -->";
  if (source === custom && !html.includes(marker)) return source;
  for (const token of [marker, "{{BASE_URL}}", "{{STYLE_URL}}", "{{RENDERER_URL}}"]) {
    if (!html.includes(token)) throw new Error(`Modular presentation template is missing ${token}: ${source}`);
  }
  const asset = (name) => {
    const override = path.join(video, name);
    return fs.existsSync(override) ? override : path.join(assets, name);
  };
  const attribute = (url) => url.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const fileUrl = (file) => {
    if (!fs.statSync(file).isFile()) throw new Error(`Template asset is not a file: ${file}`);
    return pathToFileURL(file).href;
  };
  const names = ["title", "section", "slide", "image", "terminal", "prompt", "diagram"];
  const fragments = names
    .map((name) => fs.readFileSync(asset(`templates/${name}.html`), "utf8"));
  const styles = names.map((name) => asset(`templates/${name}.css`));
  const projectStyles = path.join(video, "styles.css");
  if (fs.existsSync(projectStyles)) styles.push(projectStyles);
  const links = styles.map((file) => `<link rel="stylesheet" href="${attribute(fileUrl(file))}">`).join("\n") +
    `\n<script src="${attribute(fileUrl(asset("motion.js")))}" defer></script>`;
  const styleMarker = "<!-- SCENE_STYLES -->";
  const fallbackStyles = html.includes(styleMarker) ? "" : `${links}\n`;
  html = html.replace(styleMarker, () => links);
  const urls = { "{{BASE_URL}}": new URL(".", pathToFileURL(source)).href };
  urls["{{STYLE_URL}}"] = fileUrl(path.join(assets, "styles.css"));
  urls["{{RENDERER_URL}}"] = fileUrl(asset("renderer.js"));
  const catalog = `<script id="scene-layouts" type="application/json">${JSON.stringify(SCENE_LAYOUTS)}</script>`;
  html = html.replace(marker, () => `${fallbackStyles}${catalog}\n${fragments.join("\n")}`);
  for (const [token, url] of Object.entries(urls)) {
    html = html.replaceAll(token, () => attribute(url));
  }
  const output = path.join(work, "presentation.html");
  fs.writeFileSync(output, html, { flag: "wx" });
  return output;
}

function optionsFrom(argv, defaults = {}) {
  const options = { project: process.cwd(), ...defaults, scriptOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--script-only") {
      options.scriptOnly = true;
    } else if (["--source", "--project"].includes(argv[index]) &&
        argv[index + 1] && !argv[index + 1].startsWith("--")) {
      const key = argv[index].slice(2);
      options[key] = path.resolve(argv[++index]);
    } else {
      throw new Error(`Unknown or incomplete argument: ${argv[index]}. Use --project <directory>, --source <checkout>, or --script-only.`);
    }
  }
  return options;
}

function preflight(storyboard) {
  if (process.platform !== "darwin") throw new Error("Narration currently requires macOS and its built-in say command.");
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node.js 22 or later is required.");
  const voices = run("/usr/bin/say", ["-v", "?"]).stdout;
  for (const voice of narrationVoices(storyboard)) validateInstalledVoice(voice, voices);
  const ffmpeg = require("ffmpeg-static");
  if (!ffmpeg || !fs.existsSync(ffmpeg)) throw new Error("FFmpeg is unavailable. Install dependencies from this skill's package.json.");
  run(ffmpeg, ["-version"]);
  return ffmpeg;
}

function narrate(ffmpeg, storyboard, work) {
  return storyboard.scenes.map((scene) => {
    const input = path.join(work, `${scene.id}.txt`);
    const wav = path.join(work, `${scene.id}.wav`);
    const turns = narrationSegments(scene, storyboard.voice);
    fs.writeFileSync(input, turns.map((turn) => turn.text).join("\n\n"));
    const directory = turns.length > 1 ? path.join(work, "narration", scene.id) : work;
    if (turns.length > 1) fs.mkdirSync(directory, { recursive: true });
    const narrationAudio = turns.map((turn, index) => {
      const stem = turns.length === 1 ? scene.id : `turn-${String(index + 1).padStart(3, "0")}`;
      const text = path.join(directory, `${stem}.txt`);
      const aiff = path.join(directory, `${stem}.aiff`);
      const audio = path.join(directory, `${stem}.wav`);
      if (turns.length > 1) fs.writeFileSync(text, turn.text);
      const estimatedSeconds = turn.text.trim().split(/\s+/).length * 60 / storyboard.wordsPerMinute;
      const speechOptions = { timeout: processingTimeout(estimatedSeconds) };
      run("/usr/bin/say", ["-v", turn.voice, "-r", String(storyboard.wordsPerMinute), "-f", text, "-o", aiff], speechOptions);
      run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", aiff, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", audio], speechOptions);
      return {
        ...turn, audio: path.relative(work, audio).split(path.sep).join("/"),
        samples: Math.round(wavDuration(fs.readFileSync(audio)) * 48000),
      };
    });
    const seconds = narrationAudio.reduce((sum, turn) => sum + turn.samples, 0) / 48000;
    if (turns.length > 1) {
      const manifest = path.join(directory, "audio.ffconcat");
      fs.writeFileSync(manifest, `ffconcat version 1.0\n${narrationAudio.map((turn) => `file '${path.basename(turn.audio)}'`).join("\n")}\n`);
      run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
        "-i", manifest, "-c:a", "pcm_s16le", wav], { timeout: processingTimeout(seconds) });
    }
    const timing = sceneTiming(scene, wavDuration(fs.readFileSync(wav)), storyboard.fps,
      Array.isArray(scene.narration) ? narrationAudio : undefined);
    const padded = path.join(work, `${scene.id}-padded.wav`);
    run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", wav, "-af",
      `adelay=${Math.round(timing.leadFrames / storyboard.fps * 1000)}:all=1,apad`,
    "-t", String(timing.seconds), "-c:a", "pcm_s16le", padded], { timeout: processingTimeout(timing.seconds) });
    return { ...scene, timing, audio: path.basename(padded), narrationAudio };
  });
}

async function renderFrames(browser, storyboard, scenes, demo, work, version, template, diagramSources = {}) {
  const context = await browser.newContext({ viewport: { width: storyboard.width, height: storyboard.height } });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => errors.push(`Slide request failed: ${request.url()} (${request.failure()?.errorText})`));
    await page.route("**/*", (route) => {
      const protocol = new URL(route.request().url()).protocol;
      if (["file:", "data:"].includes(protocol)) return route.continue();
      errors.push(`Blocked non-local slide request: ${route.request().url()}`);
      return route.abort("blockedbyclient");
    });
    await page.goto(pathToFileURL(template).href);
    if (errors.length) throw new Error(`Slide loading failed:\n${errors.join("\n")}`);
    const sources = Object.create(null);
    for (const scene of scenes.filter((item) => item.visual === "diagram")) {
      if (!diagramSources[scene.id]) throw new Error(`Missing diagram source for scene "${scene.id}".`);
      sources[scene.id] = diagramSources[scene.id];
    }
    const palette = Object.keys(sources).length ? await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      const color = (name) => style.getPropertyValue(`--color-${name}`).trim();
      return {
        text: color("text"), muted: color("muted"), accent: color("accent"),
        panel: color("panel"), surface: color("surface"), fontFamily: style.fontFamily,
      };
    }) : undefined;
    const diagrams = await renderDiagrams(browser, sources, work, palette);
    const hasMotion = scenes.some((scene) => resolveSceneMotion(scene, storyboard.fps).enabled);
    if (hasMotion) {
      await page.evaluate(() => {
        for (const name of ["prepareSceneMotion", "seekSceneMotion", "clearSceneMotion"]) {
          if (typeof window[name] !== "function") throw new Error(`This template must implement window.${name} to render scene effects.`);
        }
      });
    }
    const manifest = ["ffconcat version 1.0"];
    let number = 0;
    let lastFile;
    for (const [index, scene] of scenes.entries()) {
      if (hasMotion) await page.evaluate(() => window.clearSceneMotion());
      const records = (scene.commands || []).map((id) => demo.records[id]);
      await page.evaluate((data) => window.renderScene(data), {
        scene, index, count: scenes.length, image: demo.images[scene.image || scene.visual],
        records, skillText: demo.skillText, version, websiteUrl: storyboard.websiteUrl, storyboard,
        dashboard: demo.dashboard, diagram: diagrams[scene.id],
      });
      if (errors.length) throw new Error(`Slide rendering failed:\n${errors.join("\n")}`);
      if (scene.visual === "diagram") {
        try {
          scene.diagramRender = { ...diagrams[scene.id].metadata, ...await measureDiagram(page, diagrams[scene.id]) };
        } catch (error) {
          throw new Error(`Scene "${scene.id}": ${error.message}`, { cause: error });
        }
      }
      const clipped = await page.evaluate(() => {
        const stage = document.querySelector("#stage");
        return Array.from(stage.querySelectorAll("[data-content], .title-card, .distribution, .terminal, .dashboard-layout, .skill, .prompt-block, .steps, .hero"))
          .some((node) => node.scrollHeight > node.clientHeight + 1 ||
            node.scrollWidth > node.clientWidth + 1 ||
            node.getBoundingClientRect().bottom > stage.getBoundingClientRect().bottom + 1);
      });
      if (clipped) throw new Error(`Scene "${scene.id}" overflows its presentation panel.`);
      const motion = resolveSceneMotion(scene, storyboard.fps);
      const previousFrame = motion.transition
        ? `data:image/png;base64,${fs.readFileSync(path.join(work, lastFile)).toString("base64")}` : undefined;
      const applied = motion.enabled ? await page.evaluate((options) => window.prepareSceneMotion(options), {
        ...motion, previousFrame, fps: storyboard.fps,
      }) : { intervals: [], animatedTargets: 0 };
      if (!applied || !Array.isArray(applied.intervals) || (motion.enabled &&
          (!applied.intervals.length || !Number.isSafeInteger(applied.animatedTargets) || applied.animatedTargets < 1))) {
        throw new Error(`Scene "${scene.id}": the template did not return valid motion intervals and animatedTargets.`);
      }
      let segments;
      try {
        segments = frameSegments(scene.timing, applied.intervals);
      } catch (error) {
        throw new Error(`Scene "${scene.id}": ${error.message}`, { cause: error });
      }
      scene.motion = {
        ...motion, intervals: applied.intervals, animatedTargets: applied.animatedTargets,
        capturedImages: segments.length,
      };
      for (const segment of segments) {
        await page.evaluate((text) => window.setCaption(text), segment.text);
        if (motion.enabled) {
          await page.evaluate((options) => window.seekSceneMotion(options), {
            frame: segment.startFrame, fps: storyboard.fps,
          });
        }
        if (scene.visual === "dashboard") {
          const state = segment.startFrame >= scene.timing.frames / 2 ? "filtered" : "inventory";
          await page.evaluate((state) => window.setDashboardScreen(state), {
            text: demo.dashboard.screens[state],
            label: demo.dashboard.labels[state],
          });
          const dashboardClipped = await page.locator("#dashboard-screen").evaluate((node) =>
            node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth);
          if (dashboardClipped) throw new Error("The dashboard capture overflows its terminal panel.");
        }
        const captionClipped = await page.locator("#captions").evaluate((node) => node.scrollHeight > node.clientHeight);
        if (captionClipped) throw new Error(`Caption overflows in scene "${scene.id}": ${segment.text}`);
        const file = `frame-${String(++number).padStart(4, "0")}.png`;
        await page.screenshot({ path: path.join(work, file), animations: motion.enabled ? "allow" : "disabled" });
        manifest.push(`file '${file}'`, "option framerate 30", `duration ${(segment.frames / storyboard.fps).toFixed(9)}`);
        lastFile = file;
      }
    }
    manifest.push(`file '${lastFile}'`, "option framerate 30");
    fs.writeFileSync(path.join(work, "frames.ffconcat"), `${manifest.join("\n")}\n`);
  } finally {
    await context.close();
  }
}

function encode(ffmpeg, storyboard, scenes, work, name) {
  const seconds = scenes.reduce((sum, scene) => sum + scene.timing.frames, 0) / storyboard.fps;
  const { minSeconds, maxSeconds } = durationBounds(storyboard);
  if (seconds < minSeconds || seconds > maxSeconds) {
    throw new Error(`Rendered duration would be ${seconds.toFixed(2)} seconds; adjust the storyboard to stay within ${minSeconds}-${maxSeconds} seconds.`);
  }
  const mediaOptions = { cwd: work, timeout: processingTimeout(seconds) };
  fs.writeFileSync(path.join(work, "audio.ffconcat"),
    `ffconcat version 1.0\n${scenes.map((scene) => `file '${scene.audio}'`).join("\n")}\n`);
  run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
    "-i", "audio.ffconcat", "-c:a", "pcm_s16le", "-rf64", "auto", "narration.wav"], mediaOptions);
  fs.writeFileSync(path.join(work, `${name}.srt`), subtitles(scenes, storyboard.fps));
  const music = storyboard.music?.enabled
    ? writeBackgroundMusic(path.join(work, "background-music.wav"), seconds, storyboard.music)
    : { enabled: false };
  const audioOptions = music.enabled
    ? ["-i", music.file, "-filter_complex", soundtrackFilter(storyboard.music),
      "-map", "0:v:0", "-map", "[soundtrack]"]
    : ["-map", "0:v:0", "-map", "1:a:0"];
  run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
    "-i", "frames.ffconcat", "-i", "narration.wav",
    ...audioOptions, "-t", String(seconds),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-r", String(storyboard.fps), "-threads", "4",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", `${name}.mp4`], mediaOptions);
  const decoded = run(ffmpeg, ["-hide_banner", "-i", `${name}.mp4`, "-map", "0:v:0",
    "-map", "0:a:0", "-f", "null", "-"], mediaOptions);
  const info = decoded.stderr;
  const match = info.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const measuredSeconds = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : NaN;
  if (!/Video: h264/.test(info) || !/1920x1080/.test(info) || !/30 fps/.test(info) ||
      !/Audio: aac/.test(info) || !Number.isFinite(measuredSeconds) ||
      (music.enabled && !/Audio: aac[^\n]*48000 Hz, stereo/.test(info)) ||
      Math.abs(measuredSeconds - seconds) > 0.12 || measuredSeconds < minSeconds || measuredSeconds > maxSeconds) {
    throw new Error(`The encoded MP4 does not meet the expected video/audio/duration contract:\n${info.slice(0, 5000)}`);
  }
  return {
    media: { expectedSeconds: seconds, measuredSeconds, width: 1920, height: 1080, fps: 30, video: "h264", audio: "aac" },
    music,
  };
}

function validateCaptures(storyboard, demo) {
  if (!demo || !demo.records || !demo.images || !demo.provenance) {
    throw new Error("Capture adapter must return records, images, and provenance.");
  }
  for (const scene of storyboard.scenes) {
    for (const id of scene.commands || []) {
      const record = demo.records[id];
      if (!record || typeof record.display !== "string" || typeof record.output !== "string" ||
          typeof record.executable !== "string" || !Array.isArray(record.arguments)) {
        throw new Error(`Missing actual command recording: ${id}`);
      }
    }
    if (["image", "home", "search", "details", "sources"].includes(scene.visual) &&
        !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(demo.images[scene.image || scene.visual])) {
      throw new Error(`Missing captured PNG image for scene ${scene.id}.`);
    }
    if (scene.visual === "dashboard" && (!demo.dashboard?.screens?.inventory || !demo.dashboard.screens.filtered ||
        !demo.dashboard.labels?.inventory || !demo.dashboard.labels.filtered)) {
      throw new Error(`Missing dashboard capture for scene ${scene.id}.`);
    }
    if (scene.visual === "skill" && !demo.skillText) throw new Error(`Missing skill excerpt for scene ${scene.id}.`);
  }
}

async function main(argv = process.argv.slice(2), defaults = {}) {
  const options = optionsFrom(argv, defaults);
  const root = path.resolve(options.project);
  const source = path.resolve(options.source || root);
  const storyPath = path.join(root, "video/storyboard.json");
  const statePath = path.join(root, "video/version.json");
  const output = path.join(root, "output");
  const lockPath = path.join(root, ".video-render.lock");
  const storyboard = JSON.parse(fs.readFileSync(storyPath, "utf8"));
  validateStoryboard(storyboard);
  const diagramSources = loadDiagramSources(storyboard, root);
  if (options.scriptOnly) {
    fs.writeFileSync(path.join(root, "video/SCRIPT.md"), scriptMarkdown(storyboard, diagramSources));
    console.log("Wrote video/SCRIPT.md from video/storyboard.json.");
    return;
  }
  const adapterPath = path.join(root, "video/capture.cjs");
  const adapter = require(adapterPath);
  if (typeof adapter.capture !== "function") throw new Error(`${adapterPath} must export capture(context).`);
  const ffmpeg = preflight(storyboard);
  if (adapter.preflight) await adapter.preflight({ source, run });
  const { chromium } = require("playwright");
  let lock;
  let browser;
  let work;
  try {
    try {
      lock = fs.openSync(lockPath, "wx");
    } catch (error) {
      if (error.code === "EEXIST") throw new Error("A video render lock exists. Confirm no render is running before removing .video-render.lock.");
      throw error;
    }
    fs.writeFileSync(lock, `${JSON.stringify({ pid: process.pid, host: os.hostname(), started: new Date().toISOString() })}\n`);
    fs.mkdirSync(output, { recursive: true });
    const selected = nextOutput(output, JSON.parse(fs.readFileSync(statePath, "utf8")), storyboard.outputName);
    work = fs.mkdtempSync(path.join(output, `.render-v${selected.version}-`));
    const template = prepareTemplate(root, work);
    browser = await chromium.launch({ headless: true });
    console.log(`Capturing presentation evidence for ${selected.name}...`);
    const demo = await adapter.capture({ source, projectRoot: root, work, browser, storyboard, run, isLocalRequest });
    validateCaptures(storyboard, demo);
    console.log(`Generating English narration with ${narrationVoices(storyboard).join(", ")}...`);
    const scenes = narrate(ffmpeg, storyboard, work);
    await renderFrames(browser, storyboard, scenes, demo, work, selected.version, template, diagramSources);
    await browser.close();
    browser = undefined;
    console.log("Encoding 1080p MP4 and checking the complete audio/video streams...");
    const { media, music } = encode(ffmpeg, storyboard, scenes, work, selected.name);
    fs.writeFileSync(path.join(work, "render.json"), `${JSON.stringify({
      version: selected.version,
      created: new Date().toISOString(),
      source: { path: source, ...demo.provenance.source },
      website: demo.provenance.website,
      capture: { adapter: adapterPath, ...demo.provenance },
      narration: {
        engine: "macOS say", voice: storyboard.voice, wordsPerMinute: storyboard.wordsPerMinute,
        voices: Array.from(new Set(scenes.flatMap((scene) => scene.narrationAudio.map((turn) => turn.voice)))),
        editorialDirection: storyboard.narrationDirection,
      },
      captions: "Burned into frames; timings estimated by word count within each measured narration turn, not forced alignment.",
      assistantExample: "Illustrative prompt only; no assistant execution or response is simulated.",
      media, music, storyboard, scenes, commands: demo.records,
    }, null, 2)}\n`);
    const artifacts = path.join(output, selected.name);
    fs.renameSync(work, artifacts);
    work = artifacts;
    fs.renameSync(path.join(artifacts, `${selected.name}.mp4`), path.join(output, `${selected.name}.mp4`));
    const stateTemp = path.join(root, "video/version.json.tmp");
    fs.writeFileSync(stateTemp, `${JSON.stringify({ nextVersion: selected.version + 1 }, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(stateTemp, statePath);
    console.log(`Created output/${selected.name}.mp4 (${media.measuredSeconds.toFixed(2)} seconds).`);
    console.log(`Narration, subtitles, captures, and provenance: output/${selected.name}/`);
  } catch (error) {
    if (work) console.error(`Render artifacts retained for diagnosis: ${work}`);
    throw error;
  } finally {
    if (browser) await browser.close();
    if (lock !== undefined) {
      fs.closeSync(lock);
      fs.unlinkSync(lockPath);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { optionsFrom, main, validateCaptures, processingTimeout, prepareTemplate, renderFrames, narrate };
