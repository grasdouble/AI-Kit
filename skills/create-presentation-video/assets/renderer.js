"use strict";

const layoutCatalog = document.getElementById("scene-layouts");
if (!layoutCatalog) throw new Error('Missing scene layout catalog "#scene-layouts".');
const sceneLayouts = JSON.parse(layoutCatalog.textContent);

const cloneTemplate = (id) => {
  const template = document.getElementById(id);
  if (!(template instanceof HTMLTemplateElement)) throw new Error(`Missing HTML template "#${id}".`);
  return template.content.cloneNode(true);
};
const text = (root, selector, value) => {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`Missing template binding "${selector}".`);
  node.textContent = value;
  return node;
};

const renderers = {
  title({ scene, websiteUrl }) {
    const content = cloneTemplate("scene-title");
    text(content, "[data-title]", scene.title);
    text(content, "[data-subtitle]", scene.subtitle);
    const website = text(content, "[data-website]", websiteUrl || "");
    if (!websiteUrl) website.remove();
    return content;
  },
  section({ storyboard, scene, index }) {
    const sections = storyboard.scenes.filter((item) => item.visual === "section");
    const number = storyboard.scenes.slice(0, index + 1).filter((item) => item.visual === "section").length;
    const content = cloneTemplate("scene-section");
    text(content, "[data-section-label]", `SECTION ${String(number).padStart(2, "0")} / ${String(sections.length).padStart(2, "0")}`);
    text(content, "[data-title]", scene.title);
    text(content, "[data-subtitle]", scene.subtitle);
    return content;
  },
  slide({ scene }) {
    const content = cloneTemplate("scene-slide");
    for (const point of scene.points) {
      const item = cloneTemplate("slide-point");
      text(item, "[data-point]", point);
      content.querySelector("[data-points]").append(item);
    }
    return content;
  },
  image({ scene, image }) {
    const content = cloneTemplate("scene-image");
    const img = content.querySelector("[data-image]");
    img.src = image;
    img.alt = scene.title;
    return content;
  },
  diagram({ scene, diagram }) {
    if (!diagram?.image) throw new Error(`Missing prepared diagram for scene "${scene.id}".`);
    const content = cloneTemplate("scene-diagram");
    const image = content.querySelector("[data-diagram]");
    image.src = diagram.image;
    image.alt = scene.title;
    const notes = content.querySelector("[data-diagram-notes]");
    if (scene.layout === "split") {
      for (const point of scene.points) {
        const item = document.createElement("p");
        item.dataset.content = "";
        item.textContent = point;
        notes.append(item);
      }
    } else {
      notes.remove();
    }
    return content;
  },
  terminal({ records }) {
    const content = cloneTemplate("scene-terminal");
    for (const record of records) {
      const item = cloneTemplate("terminal-record");
      text(item, "[data-command]", `$ ${record.display}`);
      const lines = record.output.trim().split("\n");
      const limit = records.length > 1 ? 7 : 15;
      text(item, "[data-output]", lines.slice(0, limit).join("\n"));
      if (lines.length <= limit) item.querySelector("[data-excerpt]").remove();
      content.querySelector("[data-terminal]").append(item);
    }
    return content;
  },
  prompt({ scene }) {
    const content = cloneTemplate("scene-prompt");
    text(content, "[data-prompt]", scene.prompt);
    text(content, "[data-steps]", scene.steps.join(" / "));
    return content;
  },
};

window.renderScene = async (data) => {
  const { storyboard, scene, index, count, version } = data;
  const visual = scene.visual === "thanks" ? "title" : scene.visual;
  if (!Object.hasOwn(renderers, visual)) {
    throw new Error(`Visual "${scene.visual}" needs a project-specific video/template.html.`);
  }
  const layout = scene.layout === undefined ? "default" : scene.layout;
  if (!sceneLayouts[scene.visual].includes(layout)) {
    throw new Error(`Invalid layout "${layout}" for visual "${scene.visual}".`);
  }
  document.body.dataset.visual = scene.visual;
  document.body.dataset.layout = layout;
  document.querySelector("#chapter").textContent = scene.chapter;
  document.querySelector("#title").textContent = scene.title;
  document.querySelector("#subtitle").textContent = scene.subtitle;
  document.querySelector("#brand").textContent = storyboard.title;
  document.querySelector("#position").textContent =
    `${index + 1} / ${count} - V${String(version).padStart(3, "0")}`;
  const stage = document.querySelector("#stage");
  stage.replaceChildren();
  stage.append(await renderers[visual](data));
  // Template images must enter the live document before they can be decoded.
  await Promise.all(Array.from(stage.querySelectorAll("img"), (img) => img.decode()));
  await document.fonts.ready;
};
window.setCaption = (caption) => { document.querySelector("#captions").textContent = caption; };
