"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateStoryboard, durationBounds } = require("./video-utils.js");
const { MUSIC_STYLES } = require("./background-music.js");

const DURATION_PRESETS = {
  teaser: { minSeconds: 30, maxSeconds: 45 },
  short: { minSeconds: 60, maxSeconds: 90 },
  standard: { minSeconds: 120, maxSeconds: 180 },
  extended: { minSeconds: 300, maxSeconds: 360 },
  "deep-dive": { minSeconds: 540, maxSeconds: 600 },
};

function initProject({
  project, title, outputName, voice, audience, duration,
  music = { enabled: true, beatsPerMinute: 104, volumeDb: -16 },
}) {
  const root = path.resolve(project);
  if (!fs.statSync(root).isDirectory()) throw new Error("The project directory must already exist.");
  const video = path.join(root, "video");
  if (fs.existsSync(video)) throw new Error("video/ already exists; inspect and update it rather than overwriting.");
  const scene = (id, chapter, heading, subtitle, visual, minimumSeconds, keyMessage, narration, extra = {}) => ({
    id, chapter, title: heading, subtitle, visual, minimumSeconds, keyMessage, narration, ...extra,
  });
  const storyboard = {
    title, outputName, audience, language: "en", voice, wordsPerMinute: 165,
    narrationDirection: "Enthusiastic, natural, and professional. Use conversational phrasing, connected transitions, and natural pauses without advertising claims.",
    width: 1920, height: 1080, fps: 30,
    duration: durationBounds({ duration }),
    music,
    scenes: [
      scene("title", "PROJECT PRESENTATION", title, "An introduction to the project.", "title", 10,
        "Introduce the project without inventing capabilities.", `Welcome to this introduction to ${title}.`),
      scene("section-overview", "01 / OVERVIEW", "Understanding the project", "Its purpose, audience, and scope.", "section", 4,
        "Introduce the overview before explaining the problem.",
        "First, let's understand the project's purpose."),
      scene("purpose", "01 / OVERVIEW", "Start with the problem.", "Draft - replace with verified project facts.", "slide", 25,
        "Explain the project's purpose using its documentation.",
        "A useful presentation starts with the problem a project solves. This draft needs the project's actual purpose and audience before it is ready to share.",
        { points: ["Who uses this project?", "What problem does it solve?", "What makes its scope clear?"] }),
      scene("section-workflow", "02 / WORKFLOW", "From purpose to practice", "A real workflow and the next step.", "section", 4,
        "Signal the transition from project context to a practical demonstration.",
        "With that context, let's explore a real workflow."),
      scene("workflow", "02 / WORKFLOW", "Follow a real workflow.", "Draft - replace with a verified user journey.", "slide", 25,
        "Connect the purpose to an actual project workflow.",
        "With that purpose established, the next step is a concrete workflow. This draft leaves room for the real steps, prerequisites, and limitations described in the project.",
        { points: ["A realistic starting point", "The main steps", "The expected outcome"] }),
      scene("environment", "02 / WORKFLOW", "A real command, not a simulated result.",
        "Starter example: Node.js version, captured in an isolated directory.", "terminal", 20,
        "Demonstrate the capture pipeline honestly before adding product commands.",
        "Here is a simple example of a real command capture. It reports the local Node.js version. Replace it with a useful project demonstration after reviewing the command's effects.",
        { commands: ["node-version"] }),
      scene("next", "02 / WORKFLOW", "Make the next step clear.", "Draft - replace with the documented first step.", "slide", 30,
        "Give viewers an accurate, practical next step.",
        "After the demonstration, viewers need a practical next step. This draft should point to the project's real documentation and explain any setup required, without promising unverified behavior.",
        { points: ["The documentation to read", "The setup to complete", "The first action to try"] }),
      scene("thanks", "THANK YOU", "Thank you for watching.", title, "thanks", 10,
        "Thank the audience for watching.", "Thank you for watching this presentation."),
    ],
  };
  if (storyboard.duration.minSeconds < 120) {
    storyboard.scenes = storyboard.scenes.filter((item) => item.visual !== "section");
  }
  const sectionSeconds = storyboard.scenes.filter((item) => item.visual === "section")
    .reduce((sum, item) => sum + item.minimumSeconds, 0);
  const draftSeconds = storyboard.scenes.filter((item) => item.visual !== "section")
    .reduce((sum, item) => sum + item.minimumSeconds, 0);
  for (const item of storyboard.scenes) {
    if (item.visual !== "section") {
      item.minimumSeconds = Number((item.minimumSeconds * (storyboard.duration.minSeconds - sectionSeconds) / draftSeconds).toFixed(3));
    }
  }
  validateStoryboard(storyboard);
  fs.mkdirSync(video);
  fs.writeFileSync(path.join(video, "storyboard.json"), `${JSON.stringify(storyboard, null, 2)}\n`, { flag: "wx" });
  fs.writeFileSync(path.join(video, "version.json"), '{\n  "nextVersion": 1\n}\n', { flag: "wx" });
  fs.copyFileSync(path.join(__dirname, "../assets/capture.cjs"), path.join(video, "capture.cjs"), fs.constants.COPYFILE_EXCL);
  return video;
}

function parseOptions(argv) {
  const values = {};
  const names = {
    "--project": "project", "--title": "title", "--name": "outputName", "--voice": "voice",
    "--audience": "audience", "--duration": "durationPreset", "--min-seconds": "minSeconds",
    "--max-seconds": "maxSeconds", "--music": "music",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = names[argv[index]];
    if (!key || !argv[index + 1] || argv[index + 1].startsWith("--")) {
      throw new Error("Use --project <directory> --title <title> --name <kebab-case-name> --voice <installed-voice>, with optional --audience <text>, --duration <standard|extended|deep-dive|teaser|short> or --min-seconds <number> --max-seconds <number>, and --music <electronic|ambient|piano|acoustic|none|on|off>.");
    }
    values[key] = argv[++index];
  }
  const { durationPreset, minSeconds, maxSeconds, music, ...options } = values;
  if (!options.project || !options.title || !options.outputName || !options.voice) {
    throw new Error("Provide --project, --title, --name, and --voice.");
  }
  if (durationPreset !== undefined) {
    if (!Object.hasOwn(DURATION_PRESETS, durationPreset)) {
      throw new Error("Choose --duration standard, extended, deep-dive, teaser, or short.");
    }
    options.duration = { ...DURATION_PRESETS[durationPreset] };
  }
  if (minSeconds !== undefined || maxSeconds !== undefined) {
    if (durationPreset !== undefined || minSeconds === undefined || maxSeconds === undefined) {
      throw new Error("Provide both --min-seconds and --max-seconds, without --duration.");
    }
    options.duration = { minSeconds: Number(minSeconds), maxSeconds: Number(maxSeconds) };
    durationBounds(options);
  }
  if (music !== undefined) {
    if (Object.hasOwn(MUSIC_STYLES, music)) {
      options.music = { enabled: true, style: music, beatsPerMinute: MUSIC_STYLES[music].beatsPerMinute, volumeDb: -22 };
    } else if (["on", "off", "none"].includes(music)) {
      options.music = { enabled: music === "on", beatsPerMinute: 104, volumeDb: -22 };
    } else {
      throw new Error("Choose --music electronic, ambient, piano, acoustic, or none (legacy on/off also accepted).");
    }
  }
  return options;
}

function main(argv) {
  const options = parseOptions(argv);
  console.log(`Created ${initProject(options)}. Replace draft copy and review captures before rendering.`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { initProject, parseOptions };
