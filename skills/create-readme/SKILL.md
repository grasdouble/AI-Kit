---
name: create-readme
description: Create or update a project's README.md — appealing, concise, GFM-formatted, no LICENSE/CONTRIBUTING/CHANGELOG sections. Use when asked to write, create, refresh, or improve a README for this repo or one of its packages.
---

# Create/Update README

Write a `README.md` the way a senior open-source engineer would: appealing, informative, easy to skim, never bloated.

## Identity

Act as a senior software engineer with deep open-source experience. The bar is a README a stranger can read in two minutes and come away knowing what the project is, why it exists, and how to run it — not an exhaustive manual.

## 1. Scope the target

- A specific package/directory named → write that package's `README.md`
- No target named, at the repo root → this monorepo's root `README.md`
- If a `README.md` already exists at the target path, read it in full first. Update only what's stale or missing (new scripts, renamed packages, outdated architecture description) — don't discard accurate sections just to rewrite in a different voice.

## 2. Research before writing

Review the actual project, not assumptions:
- `package.json` (name, description, scripts) at the target
- The monorepo root `AGENTS.md` for architecture/commands if writing the root README, or the package's own `AGENTS.md`/source layout if writing a package README
- Any existing logo/icon (e.g. `docs/`, `assets/`, `public/`) — if one exists, use it in the header

## 3. Structure and tone

Take inspiration from these READMEs for structure, tone, and pacing (skim them for pattern, don't copy content):
- https://raw.githubusercontent.com/Azure-Samples/serverless-chat-langchainjs/refs/heads/main/README.md
- https://raw.githubusercontent.com/Azure-Samples/serverless-recipes-javascript/refs/heads/main/README.md
- https://raw.githubusercontent.com/sinedied/run-on-output/refs/heads/main/README.md
- https://raw.githubusercontent.com/sinedied/smoke/refs/heads/main/README.md

A typical shape: title (+ logo if one exists) and one-line pitch, short "what/why" intro, prerequisites, setup/install, usage, key commands, architecture (only if non-trivial), links to deeper docs (`AGENTS.md`, `docs/`).

## 4. Hard rules

- **Never include** `LICENSE`, `CONTRIBUTING`, or `CHANGELOG` sections — those live in their own dedicated files; link to them instead if they exist
- **Concise over comprehensive** — cut anything a reader could find by opening the linked docs
- Don't overuse emojis — none, or a light touch at most
- Use GFM (GitHub Flavored Markdown): fenced code blocks with language tags, tables where they clarify, and [GitHub admonitions](https://github.com/orgs/community/discussions/16925) (`> [!NOTE]`, `> [!WARNING]`, etc.) where they genuinely add signal — not on every paragraph
- Every command shown must actually exist (verified in `package.json` scripts or docs) — never a placeholder
