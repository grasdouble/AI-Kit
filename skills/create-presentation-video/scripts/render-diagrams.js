"use strict";

const fs = require("node:fs");
const path = require("node:path");

async function normalizeSvg(source) {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) throw new Error("SVG must be self-contained, without document types, entities, or external stylesheets.");
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const svg = parsed.documentElement;
  const namespace = "http://www.w3.org/2000/svg";
  if (parsed.querySelector("parsererror") || svg.localName !== "svg" || svg.namespaceURI !== namespace) {
    throw new Error("Diagram source is not a valid SVG document.");
  }
  for (const node of svg.querySelectorAll("metadata")) node.remove();
  const localReference = (value) => /^#[^\s]+$/.test(value) ||
    /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
  const checkStyle = (value) => {
    if (value.includes("\\") || /@import|@font-face/i.test(value)) {
      throw new Error("SVG styles must be self-contained and use installed fonts.");
    }
    for (const match of value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
      if (!localReference(match[2].trim())) throw new Error("SVG cannot reference external resources.");
    }
  };
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    if (node.namespaceURI !== namespace ||
        ["script", "foreignObject", "animate", "animateMotion", "animateTransform", "set", "discard"].includes(node.localName)) {
      throw new Error("Diagram SVG must be static SVG, without scripts, HTML, or SMIL animation.");
    }
    if (node.localName === "style") checkStyle(node.textContent);
    for (const attribute of node.attributes) {
      if (/^on/i.test(attribute.localName)) throw new Error("SVG event handlers are not supported.");
      if (attribute.localName === "href" && !localReference(attribute.value.trim())) {
        throw new Error("SVG cannot reference external resources.");
      }
      if (attribute.localName === "style" || /url\s*\(/i.test(attribute.value)) checkStyle(attribute.value);
    }
  }
  document.body.replaceChildren(document.importNode(svg, true));
  const live = document.body.firstElementChild;
  let box = live.viewBox.baseVal;
  if (!live.hasAttribute("viewBox")) {
    if (!live.hasAttribute("width") || !live.hasAttribute("height") ||
        /%/.test(`${live.getAttribute("width")}${live.getAttribute("height")}`)) {
      throw new Error("SVG needs a positive viewBox or absolute width and height.");
    }
    live.setAttribute("viewBox", `0 0 ${live.width.baseVal.value} ${live.height.baseVal.value}`);
    box = live.viewBox.baseVal;
  }
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) {
    throw new Error("SVG needs a finite, positive viewBox.");
  }
  const width = box.width;
  const height = box.height;
  live.setAttribute("width", width);
  live.setAttribute("height", height);
  live.style.width = `${width}px`;
  live.style.height = `${height}px`;
  live.style.maxWidth = "none";
  await Promise.all(Array.from(live.querySelectorAll("image"), async (node) => {
    const source = node.href.baseVal;
    if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(source)) {
      throw new Error("SVG images must contain embedded PNG, JPEG, or WebP data.");
    }
    const image = new Image();
    image.src = source;
    await image.decode();
  }));
  await document.fonts.ready;
  if (document.getAnimations().length) throw new Error("Animated SVG diagrams are not supported; use scene.animation instead.");
  const bounds = live.getBBox();
  if (bounds.width <= 0 || bounds.height <= 0) throw new Error("SVG diagram contains no visible geometry.");
  if (bounds.x < box.x - 1 || bounds.y < box.y - 1 ||
      bounds.x + bounds.width > box.x + width + 1 || bounds.y + bounds.height > box.y + height + 1) {
    throw new Error("SVG content extends beyond its viewBox; correct the source rather than clipping it.");
  }
  const sizes = Array.from(live.querySelectorAll("text, tspan")).filter((node) => {
    const style = getComputedStyle(node);
    return node.textContent.trim() && style.display !== "none" && style.visibility !== "hidden" &&
      node.getBoundingClientRect().width > 0;
  }).map((node) => {
    const matrix = node.getScreenCTM();
    return parseFloat(getComputedStyle(node).fontSize) *
      Math.min(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
  });
  return {
    svg: new XMLSerializer().serializeToString(live), width, height,
    minFontSize: sizes.length ? Math.min(...sizes) : null,
  };
}

async function renderDiagrams(browser, sources, work, palette) {
  const prepared = Object.create(null);
  if (!Object.keys(sources).length) return prepared;
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => errors.push(`Diagram request failed: ${request.url()}`));
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).protocol === "data:") return route.continue();
      errors.push(`Blocked diagram resource: ${route.request().url()}`);
      return route.abort("blockedbyclient");
    });
    await page.setContent("<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>");
    let mermaid;
    for (const source of Object.values(sources)) {
      try {
        if (source.type === "mermaid" && !mermaid) {
          await page.addScriptTag({ path: require.resolve("mermaid/dist/mermaid.min.js") });
          await page.evaluate((palette) => window.mermaid.initialize({
            startOnLoad: false, securityLevel: "strict", theme: "base",
            htmlLabels: false, flowchart: { htmlLabels: false, useMaxWidth: false },
            themeVariables: Object.fromEntries(Object.entries({
              darkMode: true, fontFamily: palette.fontFamily, fontSize: "32px",
              background: palette.panel, primaryColor: palette.surface,
              primaryTextColor: palette.text, primaryBorderColor: palette.accent,
              secondaryColor: palette.panel, tertiaryColor: palette.surface,
              lineColor: palette.muted, textColor: palette.text,
            }).filter(([, value]) => value !== "")),
          }), palette);
          mermaid = require("mermaid/package.json").version;
        }
        const svg = source.type === "mermaid" ? await page.evaluate(async ({ id, source }) =>
          (await window.mermaid.render(`diagram-${id}`, source)).svg, source) : source.source;
        const rendered = await page.evaluate(normalizeSvg, svg);
        if (errors.length) throw new Error(errors.join("\n"));
        const sourceArtifact = `${source.id}-diagram.source.${source.type === "mermaid" ? "mmd" : "svg"}`;
        const svgArtifact = `${source.id}-diagram.svg`;
        fs.writeFileSync(path.join(work, sourceArtifact), source.source, { flag: "wx" });
        fs.writeFileSync(path.join(work, svgArtifact), rendered.svg, { flag: "wx" });
        const { svg: content, ...dimensions } = rendered;
        prepared[source.id] = {
          image: `data:image/svg+xml;base64,${Buffer.from(content).toString("base64")}`,
          metadata: {
            type: source.type, sourceFile: source.sourceFile, sourceSha256: source.sourceSha256,
            sourceArtifact, svgArtifact, ...dimensions,
            renderer: source.type === "mermaid" ? `mermaid ${mermaid}` : "Chromium SVG",
            browserVersion: browser.version(),
          },
        };
      } catch (error) {
        throw new Error(`Diagram "${source.id}": ${error.message}`, { cause: error });
      }
    }
    return prepared;
  } finally {
    await context.close();
  }
}

async function measureDiagram(page, diagram) {
  return page.evaluate(({ width, height, minFontSize }) => {
    const image = document.querySelector("#stage [data-diagram]");
    if (!(image instanceof HTMLImageElement) || !image.complete || !image.naturalWidth || !image.naturalHeight) {
      throw new Error("Diagram templates must render a decoded img[data-diagram] inside #stage.");
    }
    const style = getComputedStyle(image);
    if (style.objectFit !== "contain") throw new Error("Diagram images must use object-fit: contain, without cropping.");
    const bounds = image.getBoundingClientRect();
    const availableWidth = bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) -
      parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
    const availableHeight = bounds.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) -
      parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
    const scale = Math.min(availableWidth / width, availableHeight / height);
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("The diagram has no visible display area.");
    const minimumLabelPixels = minFontSize === null ? null : minFontSize * scale;
    if (minimumLabelPixels !== null && minimumLabelPixels < 24 - 0.01) {
      throw new Error(`Diagram labels would be ${minimumLabelPixels.toFixed(1)}px; minimum 24px. Simplify the diagram or use the full-width layout.`);
    }
    return { displayWidth: width * scale, displayHeight: height * scale, minimumLabelPixels };
  }, diagram.metadata);
}

module.exports = { renderDiagrams, measureDiagram };
