# Project and capture contract

## Layout and commands

The **skill directory** contains `scripts/`, `assets/`, `tests/` (including
standalone fixtures), and `package.json`.
The **target project** owns:

| Path | Purpose |
|---|---|
| `video/storyboard.json` | Editable story, audience, duration range, voice, music, and output name |
| `video/version.json` | `{ "nextVersion": 1 }`; advanced only after success |
| `video/capture.cjs` | Trusted, project-specific capture adapter |
| `video/template.html` | Optional specialized layout |
| `video/templates/<name>.html` | Optional override of one bundled scene fragment |
| `video/templates/<name>.css` | Optional replacement for that template's styles and variants |
| `video/styles.css` | Optional global CSS override, loaded after shared and scene styles |
| `video/renderer.js` | Optional replacement for the modular scene bindings |
| `video/motion.js` | Optional replacement for the modular motion hooks |
| `video/diagrams/*.{mmd,mermaid,svg}` | Editable, local diagram sources referenced by scenes |
| `video/SCRIPT.md` | Generated editorial script; edit the JSON instead |
| `output/<outputName>-vNNN.mp4` | Versioned video |
| `output/<outputName>-vNNN/` | Audio, frames, subtitles, full command output, and `render.json` |

Run the initializer documented in `SKILL.md` for a complete starter. It refuses
an existing `video/` directory. The skill folder can be copied as a unit to
`.agents/skills/`, `.claude/skills/`, or a personal skill location. Install its
pinned dependencies there; it does not depend on the original demo repository
or on catalog CLI packages.

## Initializer configuration

For new presentations, the assistant gathers duration, audience, installed voice,
and music preferences one question at a time as described in `SKILL.md`. Pass
the resolved choices to `scripts/init-project.js`:

| Option | Value |
|---|---|
| `--project` | Existing target-project directory (required) |
| `--title` | Presentation title (required) |
| `--name` | Lowercase kebab-case output name (required) |
| `--voice` | Exact installed macOS voice name used as the presentation default (required) |
| `--audience` | Nonempty description of the main audience |
| `--duration` | `standard` (120-180 s), `extended` (300-360 s), or `deep-dive` (540-600 s); legacy `teaser` (30-45 s) and `short` (60-90 s) also work |
| `--min-seconds`, `--max-seconds` | Custom finite numeric range; provide both instead of `--duration`, with `1 <= min <= max` and no global duration ceiling |
| `--music` | `electronic`, `ambient`, `piano`, `acoustic`, or `none`; enabled choices use the style's tempo and -22 dB; legacy `on`/`off` still work |

The initializer is noninteractive: the assistant asks the questions, and the CLI
persists the answers. It scales draft scene minimums to the selected lower
bound; the narration is still draft copy and must be rewritten to fit the chosen
format and audience. Installed voice availability is checked before a full render.
For a lower bound of at least 120 seconds, the starter includes two narrated
`section` dividers with four-second minimums. These minimums stay short even for
long presets; only the content scenes scale to fill the remaining draft budget.
Shorter ranges omit the starter dividers.
For legacy callers omitting the new options, it preserves the previous defaults:
no audience field, 120-200 seconds, and enabled music at 104 BPM and -16 dB.
This default duration range is not a limit on custom presentations. Those
compatibility defaults do not replace the new-presentation interview.

For example, after selecting a detailed technical walkthrough with piano:

```sh
node "$SKILL_DIR/scripts/init-project.js" \
  --project "$PROJECT_DIR" --title "$TITLE" --name "$OUTPUT_NAME" \
  --duration extended --audience "Developers evaluating the architecture" \
  --voice "$VOICE" --music piano
```

For a confirmed presentation of approximately 30 minutes, replace the preset with
`--min-seconds 1740 --max-seconds 1860`. Longer ranges are also accepted.

For an existing `video/`, update only the requested storyboard settings.
Do not reinitialize, reset the version counter, or replace unrelated scenes,
captures, or templates. `--script-only` includes the duration range, audience
(when set), exact voice, and music choice in the review script. The render
metadata retains the complete storyboard with these choices.

`--voice` sets the default, not an automatic voice rotation. For two narrators,
the assistant also collects the additional installed voice and allocation
(per-scene, within-scene dialogue, or both), then writes the explicit scene/turn
settings below. Do not repeat `--voice`, reinitialize an existing project, or
assign voices to scenes without the user's direction.

## Skill tests

After installing the skill's dependencies, `npm test` from its directory runs
the engine, narration validation and voice inheritance, caption timing, subtitles, versioning, music,
diagram sources, initializer, and portability tests. Their generic storyboard and capture fixtures
are bundled in `tests/fixtures/`; no target project's `video/` is required.
Music mixing tests execute the installed FFmpeg binary. The suite also streams
and fully decodes a temporary 30-minute soundtrack while checking bounded memory,
then deletes it.

On macOS, `VIDEO_RENDER_TEST=1 npm test` additionally checks browser layouts,
local diagram rendering, deterministic motion and transition cropping, and renders short static and animated
videos plus a 201-second video with a selected musical style. The static video uses
an isolated CLI and a loopback-only fixture website. These require Chromium and `Ava (Premium)`.
The multi-voice checks additionally require `Daniel (Enhanced)` and compare
actual per-voice PCM recordings, dialogue concatenation, turn-relative captions,
and a two-voice MP4. Missing test voices are reported, never downloaded.
The renders are opt-in and skipped by default, so ordinary tests do not invoke
speech synthesis or create MP4 exports. Temporary projects are cleaned up and
never advance a real project's counter.

The target project owns tests of its specific story, capture adapter, or
specialized layout. Copying the skill includes all of its own tests; it does
not copy tests of the demo or require its dependency manifest.

## Storyboard

Required top-level fields: `title`, `outputName` (lowercase kebab-case),
`language` (`en`), `voice` (exact installed macOS name), `wordsPerMinute` (100-200),
`narrationDirection` (editorial only), `width` (1920), `height` (1080), `fps` (30),
and a nonempty `scenes` array beginning with a `title` visual.

Optional fields:

| Field | Behavior |
|---|---|
| `audience` | Nonempty text describing the main audience; guides vocabulary, examples, and technical depth, and appears in the script |
| `websiteUrl` | Published HTTPS URL, never a loopback recording URL; omit for CLI-only projects |
| `duration` | `{ "minSeconds": 120, "maxSeconds": 200 }` by default for compatibility; finite numeric bounds must satisfy `1 <= min <= max`, with no fixed maximum |
| `music` | Omit for narration-only, or use e.g. `{ "enabled": true, "style": "ambient", "beatsPerMinute": 80, "volumeDb": -22 }` |

Music tempo accepts integer 80-140 BPM and gain -36 to -12 dB. Keep all three
required music fields (`enabled`, `beatsPerMinute`, `volumeDb`) when disabling
it with `enabled: false`. `style` is optional for compatibility and defaults to
`electronic` when omitted:

| Style | Arrangement | Default tempo |
|---|---|---|
| `electronic` | Pads, arpeggios, bass, and light percussion | 104 BPM |
| `ambient` | Sustained pads and sparse notes, no percussion | 80 BPM |
| `piano` | Soft synthesized piano arpeggios and bass notes | 88 BPM |
| `acoustic` | Synthesized plucked-string strums and picked notes | 96 BPM |

Each style has its own original instrumental arrangement, synthesized locally;
no external recording is used. A repeating 16-bar cycle is streamed in
one-second blocks with whole-track fades and automatic speech ducking. Memory
use does not grow with track duration; disk use does (about 346 MB for a
30-minute stereo PCM bed). WAV exports use RF64 when the audio exceeds the
RIFF size limit. Music provenance records the selected style and loop length.
Media subprocess timeouts scale with duration; commands in capture adapters
retain their default bounded timeout.

Each scene needs a unique lowercase kebab-case `id`, `chapter`, `title`,
`subtitle`, `keyMessage`, `narration`, `visual`, and positive `minimumSeconds`.
Actual timing includes the full speech, a 0.4-second lead-in and at least
one second after speech, aligned to video frames. Minimum durations are not
guaranteed final timings.

### Scene voices and dialogue

Top-level `voice` is the required default installed macOS voice. An optional
scene-level `voice` overrides it without affecting other scenes:

```json
{
  "voice": "Daniel (Enhanced)",
  "narration": "A second narrator explains this scene."
}
```

A scene's `narration` can remain a nonempty string or become a nonempty array of
ordered turns:

```json
{
  "voice": "Ava (Premium)",
  "narration": [
    { "text": "What does this project do?" },
    { "voice": "Daniel (Enhanced)", "text": "It turns verified information into reproducible presentations." },
    { "text": "Let's look at the workflow." }
  ]
}
```

These are scene excerpts; retain the normal required scene fields and the
top-level default voice. Each turn accepts only nonempty `text` and an optional,
nonempty exact installed `voice` name. Precedence is **turn > scene > presentation**.
A missing override inherits; `null`, empty names, malformed turns, and unknown
settings are errors. All configured voices, including declared defaults, are
checked before capture or speech synthesis. Uninstalled voices fail explicitly;
there is no fallback or download. Names above are examples requiring installation.

Each turn is synthesized separately at the common `wordsPerMinute`, converted
to mono 48 kHz PCM, and concatenated in source order without overlap. Native
pauses remain in the audio. The 0.4-second lead-in and at least one-second tail
are applied once to the complete scene. There is no per-turn speed, volume,
automatic voice alternation, inserted silence, or on-screen speaker label.
Changing voices can change speech duration; the selected presentation-duration
range still applies to the actual export.

For dialogue, captions are estimated by word counts **inside each measured
turn**, not across the combined scene text. Turn boundaries are rounded to
video frames using cumulative PCM sample counts; the final boundary includes
the full speech. A turn too short to receive even one frame is rejected rather
than silently omitted. Speaker names are recorded in metadata and the review
script, not spoken or added to captions. Existing single-string caption timing,
scene layouts, and motion behavior are preserved.

`scene.narrationAudio` in `render.json` records each applied voice, spoken text,
relative PCM filename, and unpadded sample count at 48 kHz. Dialogue adds
`scene.timing.turns` with each voice, zero-based turn index, and scene-relative
start/end frames; its caption cues carry the same voice and turn index.
`narration.voice` retains the global default for compatibility;
`narration.voices` lists the voices actually used.

For multi-turn scenes, source text, AIFF, and WAV files are retained under
`narration/<scene-id>/turn-001.*`, `turn-002.*`, etc., with a local concat manifest.
The root `<scene-id>.txt` is the joined transcript, `<scene-id>.wav` is the
unpadded combined speech, and `<scene-id>-padded.wav` is the final scene audio.
A single-turn scene keeps the existing root file naming. The review script
shows scene overrides and each dialogue turn; `--script-only` still works
without media dependencies or installed-voice verification.

### Scene layouts

The optional `layout` field selects a variant of the scene's existing visual.
Omit it or set `"default"` to retain the previous rendering. The supported
bundled variants are:

| Visual | Layouts |
|---|---|
| `title`, `thanks` | `default` (centered), `left` |
| `section` | `default` (centered), `split` (counter beside the content) |
| `slide` | `default` (stacked points), `cards` (numbered columns), `split` (lead point and supporting points) |
| `terminal` | `default` (stacked records), `columns` |
| `image` | `default` (full panel), `framed` |
| `diagram` | `default` (full panel), `split` (diagram and explanatory points) |
| `prompt` | `default` (stacked), `split` (prompt beside the steps) |

For example:

```json
{
  "visual": "slide",
  "layout": "cards",
  "points": ["The problem", "The workflow", "The next step"]
}
```

This is an excerpt; retain the other required scene fields. Invalid bundled
layout names fail validation rather than silently falling back to the default.
The review script and render metadata retain each selection. Custom visual
types may use project-defined kebab-case layout names implemented by their
custom template.

`cards` wraps rows when necessary. `split` emphasizes the first point and places
the others beside it; with one point it retains a full-width panel. The
`columns` terminal layout separates multiple records into columns; with one
record it separates the command from the output. All variants keep existing
capture labels, clipping notices, captions, and overflow checks. Keep text
concise; choosing a layout does not bypass the legibility checks.

### Diagram sources and rendering

Add a `diagram` visual for an explanatory diagram grounded in verified project
information. It does not require a capture-adapter image or pretend to be a
product screenshot. Retain the normal required scene fields:

```json
{
  "id": "workflow-diagram",
  "chapter": "WORKFLOW",
  "title": "A reproducible presentation pipeline",
  "subtitle": "Verified source, editable story, versioned output.",
  "keyMessage": "Explain how source information becomes a presentation.",
  "narration": "Verified source files inform the storyboard, which the local renderer turns into a versioned video.",
  "minimumSeconds": 12,
  "visual": "diagram",
  "layout": "split",
  "points": ["Start from verified information", "Retain editable sources"],
  "diagram": {
    "type": "mermaid",
    "source": "flowchart LR\n A[Source files] --> B[Storyboard]\n B --> C[MP4 export]"
  }
}
```

| Diagram field | Contract |
|---|---|
| `type` | `mermaid` or `svg` |
| `source` | Nonempty inline Mermaid definition; not available for SVG |
| `file` | Instead of `source`, a `video/`-relative `.mmd`, `.mermaid`, or `.svg` path matching the type |

Provide exactly one of `source` and `file`. For example,
`"diagram": { "type": "mermaid", "file": "diagrams/workflow.mmd" }` or
`"diagram": { "type": "svg", "file": "diagrams/architecture.svg" }`.
Create these files in the target project's `video/diagrams/` directory.
Absolute paths, parent traversal, remote URLs, unsupported settings, missing
files, and symlink targets outside `video/` fail explicitly. File references are
resolved before capture and narration and also checked by `--script-only`;
diagram syntax and display geometry require the browser renderer.

Mermaid is lazily loaded from the skill's pinned local browser bundle only when
needed. The renderer uses strict mode, plain SVG text labels, and the common
palette (`--color-text`, `--color-muted`, `--color-accent`, `--color-panel`,
`--color-surface`) and body font. Configuration directives and YAML frontmatter
are rejected so sources cannot replace renderer configuration. Simple flowcharts
and sequence diagrams are covered by the bundled checks; other Mermaid diagram
types must satisfy the same geometry and readability checks. The review script
embeds the exact Mermaid source for inline and file-based diagrams.

Imported SVG is parsed and displayed locally, with no external resource loading.
It must have a positive `viewBox` or absolute width/height and contain geometry
inside that box. Colors are preserved. Scripts, event handlers, HTML
`foreignObject`, SMIL or active CSS animation, document types/entities, external
stylesheets/resources, and downloaded fonts are unsupported. Internal references
and embedded PNG/JPEG/WebP data are allowed; embedded raster images must decode
successfully. Use plain SVG text rather than HTML labels when exporting diagrams
from another tool. Review contrast and any outlined or rasterized labels manually.

`default` fits the whole diagram into the panel; `split` puts nonempty, brief
`points` beside it. Notes are displayed only in the split layout. Neither layout
crops the diagram. Measurable SVG text, including scaled groups and `tspan`
labels, must remain at least 24 pixels in the final slide. Too-small labels or
clipped source geometry fail explicitly; simplify the diagram, use the full-width
layout, or split it across scenes rather than suppressing the check.

Each export retains `<scene-id>-diagram.source.mmd` (or `.source.svg`) and
`<scene-id>-diagram.svg`. `scene.diagramRender` in `render.json` records source
type/path, source SHA-256, artifact filenames, renderer/version, intrinsic
dimensions, minimum measurable font size, displayed dimensions, and minimum
displayed label size. Existing motion works on the diagram's containing blocks,
not on individual SVG nodes; effects remain opt-in. The initializer and existing
storyboards are not migrated or given diagram scenes automatically.

### Animations and transitions

Effects are optional per-scene objects; omitting them keeps the previous static
rendering. There is no automatic animation, global default, or starter migration.

```json
{
  "animation": {
    "type": "stagger",
    "durationSeconds": 0.6,
    "delaySeconds": 0.1,
    "staggerSeconds": 0.12
  },
  "transition": { "type": "wipe-left", "durationSeconds": 0.35 }
}
```

Retain the other required scene fields. Either effect can be explicitly disabled
with `{ "type": "none" }`.

| Effect | Types | Timing |
|---|---|---|
| `animation` | `fade-in`, `slide-up`, `zoom-in`, `stagger` | `durationSeconds` defaults to 0.6; `delaySeconds` to 0 |
| `transition` | `fade`, `wipe-left`, `wipe-right` | `durationSeconds` defaults to 0.35; begins at scene frame 0 |

`stagger` alone accepts `staggerSeconds` (default 0.12). It animates the direct
children of the scene's root element successively, falling back to the root if
there are no children. Other entry animations affect that root as a whole.
Existing transforms and opacity are preserved. Captions, footer, and the shared
page header are not entry-animation targets.

Transitions overlay the previous scene's final image above the incoming scene.
The overlay is cropped at the panel bottom or caption top, whichever comes first,
so incoming captions and footer remain uncovered. `fade` dissolves the outgoing
image; the wipes remove it toward the named edge. A transition on the opening
scene is invalid because there is no previous image; use an entry animation.
An animation and transition can run simultaneously.

Unknown types, unsupported settings, nonpositive durations, and negative delays
are errors. Durations round up to whole video frames; delays and staggering
round to the nearest frame. All intervals, including the last staggered target,
must fit inside the actual synthesized scene duration. Overlong effects fail
explicitly without advancing the export counter. No automatic padding,
cross-scene overlap, narration edits, or subtitle shifts are applied.

Effects use paused Web Animations sought to each exact video-frame timestamp,
not real-time browser recording. Moving intervals capture one PNG per frame;
static intervals reuse an image until the next effect or caption boundary.
Long effects cost proportionally more render time and disk space. Metadata
records resolved frame counts, active intervals, animated-target count, and
captured-image count; the review script describes each selected effect.

The bundled layout supports:

| Visual | Additional fields |
|---|---|
| `title`, `thanks` | None; centered title and subtitle |
| `section` | None; distinctive section-title card, subtitle, and automatic section counter |
| `slide` | `points`: nonempty array of brief strings |
| `image` | `image`: key into the adapter's `images` map |
| `diagram` | `diagram`: Mermaid or SVG source; `split` also requires `points` |
| `terminal` | `commands`: array of keys into the adapter's `records` map |
| `prompt` | `prompt` and nonempty `steps` array; visibly labeled illustrative |

The existing demo also uses `distribution`, `intro`, `home`, `search`,
`details`, `sources`, `dashboard`, `skill`, and `outro`. These require its
custom template and adapter data. They are not generic product capabilities.
For other custom visuals, extend validation and layout together rather than
silently substituting another visual.

### Section-title slides

Use explicit `section` scenes to separate the major parts of a presentation:

```json
{
  "id": "section-discovery",
  "chapter": "02 / DISCOVER",
  "title": "Find the right practice",
  "subtitle": "From browsing the catalogue to choosing one useful task.",
  "keyMessage": "Introduce the discovery chapter.",
  "narration": "With the purpose clear, let's find a practice worth trying.",
  "visual": "section",
  "minimumSeconds": 4
}
```

Place the divider after the opening `title` and before its content, and use
the same `chapter` label for that content. A divider before each major part
makes transitions visible; do not insert one before every scene. Avoid empty
sections or consecutive dividers. The opening must still be a `title`, and
the closing remains a separate `thanks` scene.

The bundled template shows `SECTION 01 / 03`, deriving both numbers from the
explicit section scenes in storyboard order. No numbering fields or capture
data are required. A section's title and subtitle are shown prominently;
the published website URL is reserved for the opening and closing cards.
The shared page header is hidden on opening (`title`), section, and closing
(`thanks`) cards, which expand into that space without moving captions or the
footer. Content visuals retain the normal header and panel dimensions.
The renderer sets `body[data-visual]` to the current scene's visual; the shared
stylesheet applies the appropriate card layout.
The section's narration is spoken and captioned normally, and the script
export labels it `Section divider` with the same numbering.

Aim for a brief 4-6 second narrated transition. As with other scenes, actual
timing includes the full speech and its lead-in and tail; four seconds is a
minimum, not a truncation limit. Include transitions in the chosen duration
budget and rebalance content when necessary. Existing storyboards without
sections remain valid and are never rewritten automatically.

## Capture adapter

Export `capture(context)` from `video/capture.cjs`; optional `preflight({source,
run})` validates project-specific files and tools before capture.

The capture context provides:

| Property | Value |
|---|---|
| `projectRoot` | Absolute presentation-project directory |
| `source` | Absolute source directory selected by `--source` |
| `work` | New render-specific artifact directory |
| `browser` | Managed Playwright browser; close contexts, not the browser |
| `storyboard` | Validated JSON |
| `run(command, args, options)` | Synchronous, bounded, no-shell command execution; errors throw |
| `isLocalRequest(url, origin)` | Exact-origin comparison for browser routing |

Return `{ records, images, provenance }`, with optional project-specific
`dashboard` and `skillText`. Empty maps are allowed when no scene needs them.
Missing required data is an error, never a success-shaped placeholder.

Command records contain the command shown to viewers (`display`), the actual
`executable`, its `arguments` array, and complete `output`. The starter adapter
demonstrates this with a real `node --version` command in isolated directories.
Replace its example with reviewed project commands. Do not concatenate commands
into shell strings; do not capture sensitive environment variables or output.

Image values are PNG data URLs from real screenshots:

```js
const file = path.join(work, "website-home.png");
await page.screenshot({ path: file, animations: "disabled" });
images.home = `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
```

Before navigating, block requests outside the intended local origin. Accumulate
and reject page errors, failed responses, and blocked requests. Wait for actual
content readiness and `document.fonts.ready`, not a fixed delay. Close the
context and stop any server in `finally`. Do not fetch the published website
merely to bypass unavailable access.

`provenance` describes what actually happened: local versus hosted capture,
isolation, mutations, and optional `source: {commit, dirty}` and
`website: {publishedUrl, captureMethod, hostedSiteVisited}` metadata. The adapter
is trusted executable code, **not a sandbox**; isolation of files alone does
not prevent network access or arbitrary side effects.

## Modular templates

The default layout is split into independently editable files:

```text
assets/
  template.html              Shared page shell: header, stage, captions, footer
  styles.css                 Shared page, header, stage, captions, footer, notices
  renderer.js                Scene data bindings and section numbering
  motion.js                  Opt-in paused animation and transition hooks
  templates/
    title.html / title.css       Opening and closing cards (title and thanks)
    section.html / section.css   Section dividers
    slide.html / slide.css       Talking points and the repeated point template
    image.html / image.css       Captured image
    diagram.html / diagram.css   Local Mermaid/SVG diagram and optional notes
    terminal.html / terminal.css Terminal container and repeated command records
    prompt.html / prompt.css     Explicitly illustrative prompt
```

Each fragment contains native HTML `<template>` elements, not a complete page.
Keep the shared palette (CSS custom properties) and page styles in `styles.css`;
each template's appearance and
layout variants belong in its matching CSS file. Keep markup in the HTML files
and data-binding logic in `renderer.js`. Titles and closing cards intentionally
share `title.html` and `title.css`. The renderer exposes the current
`body[data-visual]` and `body[data-layout]` for template-scoped variant selectors.
Preserve template IDs, `data-*` binding attributes, and `data-content` overflow
markers when changing markup.

The engine assembles the shell and fragments into `presentation.html` inside
the render's work directory. It resolves local stylesheet and script URLs before
opening the page; no HTTP server, browser-side fragment fetching, or extra
dependencies are required. The assembled page remains with the render artifacts.
The source shell contains `<!-- SCENE_TEMPLATES -->`, `{{BASE_URL}}`,
`{{STYLE_URL}}`, and `{{RENDERER_URL}}` markers, plus the optional
`<!-- SCENE_STYLES -->` marker for scene stylesheet links in the head.
Older modular shells without the style marker still work; stylesheet links
are inserted beside the fragments instead. The engine also embeds the
supported-layout catalog as non-executable JSON for the browser renderer.
Use the renderer rather than opening this unassembled source shell directly.

For a project-specific change, copy only the relevant fragment into
`video/templates/`, retaining its name. For example,
`video/templates/section.html` overrides its markup, while
`video/templates/section.css` independently replaces its styles. Copy and edit
the corresponding bundled file to retain other variants and layout rules.
Unchanged files still use bundled defaults.

The bundled common stylesheet loads first, then the seven selected template
stylesheets, then an optional `video/styles.css` global override. Existing
project-wide styles, including previously copied monolithic stylesheets, still
take precedence; new template-specific changes should go in `video/templates/`.
The optional `video/renderer.js` replaces the bindings when a project needs
new behavior. The bundled `motion.js` loads without starting any effects;
`video/motion.js` can replace its hooks independently.

## Specialized template

A custom `video/template.html` defines:

- `window.renderScene({ storyboard, scene, index, count, image, diagram, records, skillText, dashboard, version, websiteUrl })`
- `window.setCaption(text)`
- `#stage` and `#captions` elements
- Content containers marked `data-content` for overflow checks
- For dashboard visuals: `#dashboard-screen` and `window.setDashboardScreen({text, label})`

Set text with `textContent`, await image decoding and font readiness, and use
local assets. Rendered slides cannot make HTTP requests. Existing complete,
self-contained custom templates remain supported without modification and
are loaded from their original path, preserving their relative assets.
They do not need the bundled fragments, stylesheet, or renderer.

Prefer individual fragment or CSS overrides before replacing the complete
layout. If copying `assets/template.html` to customize the shared shell, retain
all four assembly markers documented above; the engine then assembles it with
project overrides and bundled defaults. Relative assets in that copied shell
resolve against its original `video/` directory, not the render directory.
When using section scenes, add an explicit `section` branch to a specialized
template as well; do not silently substitute a content slide. Mark its
container with `data-content` so the engine checks for layout overflow.

For diagram scenes, `diagram.image` contains the prepared SVG data URL and
`diagram.metadata` its dimensions and provenance. Render it in a decoded
`img[data-diagram]` inside `#stage`, with `object-fit: contain` and a positive
display area. The engine measures this element before applying scene motion.
Use `scene.title` as alternative text. Keep geometry and measurable labels
visible; fragment or CSS overrides do not bypass the 24-pixel label check.
Legacy templates without diagram scenes require no new API.

### Custom motion hooks

Complete legacy templates need no new hooks when all effects are off.
If any scene enables an effect, the template must provide these functions;
missing hooks or invalid capture intervals fail explicitly:

- `window.clearSceneMotion()`: cancel old animations, remove outgoing overlays,
  and restore static styles before the next scene renders.
- `window.prepareSceneMotion({ animation, transition, previousFrame, fps })`:
  create paused effects and return, or resolve to,
  `{ intervals: [{ startFrame: 0, endFrame: 18 }], animatedTargets: 1 }`.
- `window.seekSceneMotion({ frame, fps })`: seek every effect to this exact
  scene-relative frame without allowing wall-clock playback.

`animation` and `transition` are null or resolved objects containing `type`,
`keyframes`, `durationFrames`, `delayFrames`, `staggerFrames`, and `perItem`.
`previousFrame` is the previous scene's final PNG data URL, supplied only for a
transition. Intervals use inclusive starts and exclusive ends; all bounds must
be safe nonnegative integer frame counts within the scene, with positive
extent. Enabled effects must return at least one interval and a positive integer
`animatedTargets`. Overlapping intervals are allowed and do not duplicate frames.

The engine clears effects before rendering and checking the static layout, then
prepares and seeks them for each captured segment. Built-in motion hooks expect
rendered content under `#stage` and a `#captions` element; the transition CSS lives
in the common stylesheet. A complete custom template can copy these local assets
or implement equivalent hooks and styling. Keep all animation handles paused;
the engine deliberately allows their current state during screenshots rather
than fast-forwarding them as it does for static scenes.

## Outputs and failure handling

Exports contain 1080p/30-fps H.264 video and AAC narration/music. Keep the original
`narration.wav`, optional `background-music.wav`, SRT, frames, captures, and
provenance alongside the MP4, including individual dialogue recordings when used.
Inspect the actual video before handing it off.

The renderer locks per presentation project. File/directory collisions advance
the selected version without overwriting output. The counter is updated after a
successful encoded and decoded export; failures keep diagnostics and do not
advance it. Never remove a lock without checking its recorded PID and host.
Do not commit generated media or expose machine paths and transcripts in public
artifacts without review.
