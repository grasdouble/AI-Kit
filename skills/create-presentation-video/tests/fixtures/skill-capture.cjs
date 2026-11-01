"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

async function capture({ browser, work, run, isLocalRequest }) {
  const project = path.join(work, "demo-project");
  const home = path.join(work, "demo-home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const result = run(process.execPath, ["--version"], { cwd: project, env: { ...process.env, HOME: home } });
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<!doctype html><title>Fixture app</title><h1>Local fixture app</h1><button onclick="this.textContent=\'Captured\'">Capture</button>');
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let context;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    context = await browser.newContext({ viewport: { width: 1440, height: 660 } });
    const errors = [];
    await context.route("**/*", (route) => {
      if (isLocalRequest(route.request().url(), origin)) return route.continue();
      errors.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (!response.ok()) errors.push(`HTTP ${response.status()}`);
    });
    await page.goto(origin);
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    await page.getByRole("button", { name: "Captured", exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(work, "website-home.png");
    await page.screenshot({ path: file, animations: "disabled" });
    if (errors.length) throw new Error(`Fixture capture failed: ${errors.join(", ")}`);
    return {
      records: {
        "node-version": {
          display: "node --version", executable: process.execPath, arguments: ["--version"],
          output: result.stdout + result.stderr,
        },
      },
      images: { home: `data:image/png;base64,${fs.readFileSync(file).toString("base64")}` },
      provenance: { localFixtureVisited: true, networkUsed: "loopback only", homeIsolated: true },
    };
  } finally {
    if (context) await context.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

module.exports = { capture };
