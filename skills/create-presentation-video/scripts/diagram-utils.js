"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

function validateDiagram(scene) {
  const diagram = scene.diagram;
  if (!diagram || typeof diagram !== "object" || Array.isArray(diagram) ||
      !["mermaid", "svg"].includes(diagram.type)) {
    throw new Error(`Scene "${scene.id}" needs a diagram with type mermaid or svg.`);
  }
  for (const key of Object.keys(diagram)) {
    if (!["type", "source", "file"].includes(key)) throw new Error(`Unknown diagram setting "${key}" for scene ${scene.id}.`);
  }
  const inline = diagram.source !== undefined;
  const file = diagram.file !== undefined;
  if (inline === file || (inline && (diagram.type !== "mermaid" ||
      typeof diagram.source !== "string" || !diagram.source.trim()))) {
    throw new Error(`Scene "${scene.id}": use one Mermaid source or one local diagram file; SVG requires a file.`);
  }
  if (file) {
    if (typeof diagram.file !== "string" || !diagram.file.trim() || path.isAbsolute(diagram.file) ||
        /^[a-z][a-z0-9+.-]*:/i.test(diagram.file) || /[\\\u0000-\u001f\u007f]/.test(diagram.file) ||
        diagram.file.split("/").some((part) => part === ".." || !part) ||
        !(diagram.type === "svg" ? /\.svg$/i : /\.(?:mmd|mermaid)$/i).test(diagram.file)) {
      throw new Error(`Scene "${scene.id}": diagram.file must be a video-relative .${diagram.type === "svg" ? "svg" : "mmd or .mermaid"} path.`);
    }
  }
  if ((scene.layout === "split" || scene.points !== undefined) &&
      (!Array.isArray(scene.points) || !scene.points.length ||
       !scene.points.every((point) => typeof point === "string" && point.trim()))) {
    throw new Error(`Scene "${scene.id}": a split diagram needs nonempty, brief points.`);
  }
}

function loadDiagramSources(storyboard, projectRoot) {
  const sources = Object.create(null);
  for (const scene of storyboard.scenes.filter((item) => item.visual === "diagram")) {
    validateDiagram(scene);
    const { type, file } = scene.diagram;
    let source = scene.diagram.source;
    if (file !== undefined) {
      const base = fs.realpathSync(path.join(projectRoot, "video"));
      const target = fs.realpathSync(path.resolve(base, file));
      const relative = path.relative(base, target);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Scene "${scene.id}": diagram files must remain inside video/, including symlink targets.`);
      }
      if (!fs.statSync(target).isFile()) throw new Error(`Scene "${scene.id}": diagram source is not a file.`);
      source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(target));
    }
    if (!source.trim()) throw new Error(`Scene "${scene.id}": diagram source is empty.`);
    if (type === "mermaid" && (/%%\s*\{/.test(source) || /^\s*---(?:\r?\n|$)/.test(source))) {
      throw new Error(`Scene "${scene.id}": Mermaid configuration directives and frontmatter are not supported; use the shared theme and scene fields.`);
    }
    sources[scene.id] = {
      id: scene.id, type, source, sourceFile: file === undefined ? null : `video/${file}`,
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    };
  }
  return sources;
}

function diagramDescription(scene, sources = {}) {
  if (scene.visual !== "diagram") return "";
  const diagram = scene.diagram;
  let description = `\n**Diagram:** ${diagram.type}; ${diagram.file ? `file \`video/${diagram.file}\`` : "inline storyboard source"}.\n`;
  const source = sources[scene.id]?.source ?? diagram.source;
  if (diagram.type === "mermaid" && source !== undefined) {
    const fence = "`".repeat(Math.max(3, ...Array.from(source.matchAll(/`+/g), ([match]) => match.length + 1)));
    description += `\n${fence}mermaid\n${source}\n${fence}\n`;
  }
  return description;
}

module.exports = { validateDiagram, loadDiagramSources, diagramDescription };
