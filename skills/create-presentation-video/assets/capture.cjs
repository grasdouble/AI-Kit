"use strict";

const fs = require("node:fs");
const path = require("node:path");

async function capture({ work, run }) {
  const project = path.join(work, "demo-project");
  const home = path.join(work, "demo-home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const args = ["--version"];
  const result = run(process.execPath, args, {
    cwd: project,
    env: { ...process.env, HOME: home, NO_COLOR: "1" },
  });
  return {
    records: {
      "node-version": {
        display: "node --version",
        executable: process.execPath,
        arguments: args,
        output: result.stdout + result.stderr,
      },
    },
    images: {},
    provenance: {
      method: "Starter example: actual Node.js version command, not a product demonstration.",
      homeIsolated: true,
      mutationsRequested: false,
      networkUsed: false,
    },
  };
}

module.exports = { capture };
