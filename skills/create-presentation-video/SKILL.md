---
name: create-presentation-video
description: Create or iterate on a reproducible English project-presentation video, asking for a standard or custom duration, audience, installed narration voices, and musical style or narration only. Supports scene-level voices and multi-voice dialogue, local Mermaid and SVG diagrams, section dividers, selectable layouts, opt-in animations and transitions, long presentations, real website and CLI captures, local macOS narration, captions, and versioned MP4 exports. Use when asked to make a demo video, write and render a presentation, add a second narrator, create diagrams, add section dividers or visual effects, or configure its duration, audience, voices, or music.
---

# Create a presentation video

Turn verified project information into a clear presentation of the chosen length.
This skill bundles the renderer, a generic HTML layout, a project initializer,
and original instrumental music synthesis. Product-specific captures belong to
the target project, not the skill.

## 1. Establish the brief

Read the project's guidance, README, commands, and relevant UI/CLI code. Inspect
`video/storyboard.json` if it exists. Identify the purpose and verified capabilities,
then collect the four preferences below **before initializing a new presentation
or writing its narrative**.

Version 1 supports **English text and captions**, **1080p at 30 fps**, and
**macOS `say` narration** with any installed voice. A French voice can read
English text but may pronounce it unnaturally. There is no emotional-style
parameter; express delivery through the writing, punctuation, and speech rate.
There is **no fixed maximum presentation duration**. The chosen duration range
is still enforced; available disk space, render time, and platform resources
remain practical constraints.

### Invocation-time questions

Use the assistant's question tool when available, with **one question at a time**
and selectable choices. Ask in the user's conversation language; the question
examples below are in English, independently of the video's English narration.

1. **Duration:** "How long should the presentation be?"

   | Choice | Initializer preset | Duration range |
   |---|---|---|
   | Standard overview (recommended) | `standard` | 2-3 minutes (120-180 seconds) |
   | Detailed walkthrough | `extended` | 5-6 minutes (300-360 seconds) |
   | In-depth presentation | `deep-dive` | 9-10 minutes (540-600 seconds) |

   Accept custom durations, including **30 minutes or more**, without imposing
   another global ceiling. The range must use finite numbers with
   `1 <= minSeconds <= maxSeconds`. For an approximate single target,
   propose a range around it and ask for confirmation rather than silently
   converting it. The older `teaser` and `short` presets remain available if
   the user requests a shorter format.

2. **Audience:** "Who is the main audience?"

   Offer developers and technical contributors, potential users evaluating the
   project, technical leads and decision-makers, and a general non-technical
   audience. Accept a more specific audience in free text. Use this choice to
   select examples, explain terminology, and set the depth of technical detail.

3. **Voice:** "Which narration voice would you like for the English presentation?"

   First run `/usr/bin/say -v '?'`. Offer a short list of **actually installed
   English voices**, retaining their exact names and indicating their English
   locale. Prefer a natural voice such as `Ava (Premium)` only if installed;
   never invent a voice choice or silently substitute for a requested voice.
   A non-English installed voice requires an explicit choice and a warning about
   English pronunciation. Do not download voices without permission.

   If the user requests two voices, resolve whether they want a voice per scene,
   dialogue within a scene, or both, asking only if this is not already known.
   Ask for each missing voice choice separately from the actually installed list
   and reuse known choices. Apply the same language warning to every voice.
   Keep the primary voice as the presentation default; save explicit scene or
   turn overrides as described below. Do not alternate voices automatically or
   rewrite an approved narrative into dialogue without the user's request.

4. **Music:** "Which musical style would you like beneath the narration, or narration only?"

   | Choice | `music.style` / CLI choice | Default tempo |
   |---|---|---|
   | Light electronic | `electronic` | 104 BPM |
   | Ambient, without percussion | `ambient` | 80 BPM |
   | Soft piano | `piano` | 88 BPM |
   | Acoustic-inspired plucked strings | `acoustic` | 96 BPM |
   | Narration only | `--music none` | Disabled |

   Music is an original, locally synthesized instrumental, kept quiet at -22 dB
   with speech ducking. The piano and acoustic options use synthesized timbres,
   not recorded instruments. Save the chosen `music.style`, tempo, and gain.
   For narration only, set `music.enabled` to `false`, keeping the tempo and gain
   fields. Do not silently substitute or relabel an unsupported requested style.

Reuse preferences already supplied in the request or conversation, and existing
storyboard settings unless the user asks to change them. **Do not silently pick
missing preferences for a new presentation or ask again about known choices.**
For a scoped iteration, ask only what is needed for that change; a voice change
must not restart the full brief. If the user explicitly delegates the choices or
requests autonomous generation, state the selected assumptions and continue:
prefer `standard`, an audience grounded in the project, an installed English
voice, and quiet electronic music. The initializer's legacy defaults are not user approval.

Summarize the resolved duration range, audience, exact voice choices, and music setting
before writing the story. Save `duration`, `audience`, the default `voice`, and
`music` in `video/storyboard.json`, with additional voices in scene or turn
overrides; retain these choices on subsequent renders.

## 2. Prepare or resume the project

Read [the project and capture contract](references/project.md) before changing
configuration or captures. Let `SKILL_DIR` be this skill's absolute directory,
resolved from the loaded `SKILL.md` location. It may be installed in a project,
in a user directory, or for either assistant; never assume the current working
directory is the skill directory.

If `video/` exists, inspect and preserve its storyboard, version counter, capture
adapter, and custom template. **Do not initialize over existing work.**

For a new project, run the initializer with the real project directory and the
resolved brief. For example, after the user has chosen the standard duration,
a developer audience, an installed voice, and ambient music:

```sh
node "$SKILL_DIR/scripts/init-project.js" \
  --project "$PROJECT_DIR" --title "$TITLE" --name "$OUTPUT_NAME" \
  --duration standard --audience "Developers and technical contributors" \
  --voice "$VOICE" --music ambient
```

Use the selected preset, audience, and musical style or `none`, not the example choices
unconditionally. For a custom duration, replace `--duration standard` with
`--min-seconds 1740 --max-seconds 1860` for a confirmed 29-31 minute range;
do not combine a preset with custom bounds.
For an existing project, edit only the requested storyboard fields instead of
rerunning the initializer.

This creates `video/storyboard.json`, `video/version.json`, and
`video/capture.cjs`, without modifying the project's package manifest. The starter
contains clearly labeled **draft copy and a real Node.js version capture**, not
claims about the product. Replace those before delivering a product video.
Ignore `output/`, `.video-render.lock`, and dependency directories in Git without
discarding existing ignore rules.

## 3. Write the story before the narration

Start with a title and welcome, explain the problem and scope, introduce the
workflow, demonstrate verified capabilities, summarize the next step, and thank
the viewer. Do not force a website, CLI, or skill segment onto a product that
does not have one.

Adapt the vocabulary and demonstration depth to `audience`. Budget the scene
count, narration, and pauses against the chosen `duration` range. The initializer
scales draft scene minimums, but its draft copy is not automatically shortened;
rewrite it before rendering. Short formats need fewer messages, not faster
speech or omitted opening and closing scenes. Leave room for narration lead-ins
and scene tails, then check actual synthesized timing against the range.
For longer presentations, build chapters with substantive explanations and
verified demonstrations. Do not meet a 30-minute brief by stretching six draft
slides, padding silence, or repeating the same claims.

### Use one or multiple narration voices

The top-level `voice` remains the required default, and existing text narration
keeps its single-voice behavior. To change the narrator for one scene:

```json
{
  "voice": "Daniel (Enhanced)",
  "narration": "This scene is narrated by the second voice."
}
```

For a dialogue inside one scene, replace its narration string with ordered turns:

```json
{
  "narration": [
    { "voice": "Ava (Premium)", "text": "How does the workflow begin?" },
    { "voice": "Daniel (Enhanced)", "text": "It begins with verified project information." }
  ]
}
```

Both are scene excerpts, not complete storyboards; retain the other required
fields. These voice names are examples, not permission to choose or download
them: confirm that the requested names are installed. A turn's `voice` overrides
the scene's `voice`, which overrides the presentation's `voice`. Omitted turn
voices inherit that hierarchy; missing or uninstalled requested voices fail
rather than being silently substituted. The initializer's `--voice` still sets
only the presentation default; assign additional voices in the storyboard.

Keep each turn concise and use only `text` and optional `voice`. Turns play in
array order without overlap, using the common `wordsPerMinute`. Do not encode
speaker names, delivery instructions, or unsupported speech markup in spoken
text. Native speech pauses are retained; the lead-in and final tail are applied
once per scene, not around every turn. Switching voices can change actual
speech duration, so rebalance only when needed to meet the agreed duration range.

The review script identifies each narrator and turn. Captions retain only the
spoken text, without automatic speaker labels. Their boundaries follow the
measured duration of each turn, with word-count estimates inside that turn;
they are not forced word alignment. The export retains separate turn recordings,
the combined scene audio, actual voices, and scene-relative frame timing.
Voice changes are independent of layouts, diagrams, animations, and transitions.
Do not migrate existing storyboards or change their narrator automatically.

### Make section transitions visible

For multi-part presentations, insert a dedicated `"visual": "section"` scene
before each major part, including the first part after the opening title.
A small chapter label on a content slide is not a substitute for a section
divider. Use a short section title, a one-sentence subtitle explaining what
comes next, and a brief narrated bridge from the preceding part. Keep the
following content scenes' `chapter` labels consistent with that section.

The bundled layout gives these scenes a distinctive title-card treatment and
an automatic `SECTION 01 / 03` counter based only on explicit section scenes.
The shared header is hidden on opening, section, and closing cards to avoid
repeating their titles and subtitles; the card expands upward while captions
and the footer stay in place.
They need no captures or extra fields beyond the normal scene contract.
The generated script marks them as section dividers so they can be approved
alongside the narrative. Custom templates must implement the `section` visual.

Budget roughly 4-6 seconds per transition, allowing the complete narration
and its tail to finish. Count this time inside the agreed duration range;
rebalance the content rather than speeding up the voice or extending the
range silently. The initializer includes two four-second dividers for ranges
starting at 120 seconds or more, without stretching them for long presets.
Shorter formats omit them by default; use them only when they improve clarity.
Avoid consecutive dividers or sections without substantive content.

Existing storyboards remain valid and are not migrated automatically.
When asked to add transitions to an existing video, preserve its brief,
captures, unrelated narrative, and version counter; revise only the dividers,
directly related bridges, and any content needed to keep the agreed timing.

### Select scene layouts

Each scene may specify `layout`; omitting it or using `"default"` preserves
the existing appearance. Choose variants deliberately rather than randomly
changing every slide, and preserve an existing choice unless the user requests
a visual revision. The review script includes the selected layout.

| Visual | Alternative layouts |
|---|---|
| `title`, `thanks` | `left`: left-aligned title card with an accent |
| `section` | `split`: section counter beside the title and subtitle |
| `slide` | `cards`: numbered columns; `split`: a lead point beside supporting points |
| `terminal` | `columns`: records side by side, or command beside output for one record |
| `image` | `framed`: inset capture with a border |
| `diagram` | `split`: diagram beside brief explanatory `points` |
| `prompt` | `split`: illustrative prompt beside the steps |

For example, use `"visual": "slide", "layout": "cards"` in the storyboard.
These are layout variants of the same template, not new visual types.
See the project reference for point-count behavior and customization.

### Create and display diagrams

Use a `"visual": "diagram"` scene when architecture, relationships, a workflow,
or an exchange is clearer as a diagram. First inspect the relevant project
files, then write the diagram's nodes, edges, and labels from verified facts.
A diagram is an explanatory visualization, not a recorded product capture;
never invent services, interactions, or implementation details. Clearly label
conceptual or proposed designs if the user requests them.

Prefer editable Mermaid for flowcharts and sequence diagrams. Write a Mermaid
source inline, or create a `.mmd`/`.mermaid` file under `video/diagrams/`:

```json
{
  "visual": "diagram",
  "diagram": {
    "type": "mermaid",
    "source": "flowchart LR\n A[Verified source] --> B[Storyboard]\n B --> C[MP4 export]"
  }
}
```

This is a scene excerpt; retain its title, subtitle, key message, narration, and
timing fields. To use a file, replace `source` with
`"file": "diagrams/workflow.mmd"`; never supply both.
For an existing or newly authored SVG, use
`"diagram": { "type": "svg", "file": "diagrams/architecture.svg" }`.
Create real source files before referencing them. Paths are relative to
`video/`, must remain inside it even through symlinks, and cannot be URLs.

SVG files must be self-contained and static, with a positive `viewBox` or
absolute dimensions. Use SVG shapes and text rather than HTML `foreignObject`
labels. Scripts, event handlers, external images/styles/fonts, and embedded
animations are rejected. Embedded PNG/JPEG/WebP data and internal markers,
gradients, and references are supported. Keep SVG text readable and contrast it
against the panel; imported SVG colors are preserved, not automatically recolored.

The dedicated `diagram.html` / `diagram.css` template fits the whole diagram
without cropping. Use the default layout for maximum space, or `"layout": "split"`
with a nonempty `points` array for notes beside it. Split complex diagrams across
scenes instead of shrinking labels: measurable SVG text must remain at least
24 pixels after fitting. Outlined text and raster labels require visual review.

Mermaid renders locally with the pinned dependency and the shared palette;
no diagram source is sent to a hosted renderer. Do not put Mermaid configuration
directives or YAML frontmatter in the source; use scene fields and the common
theme instead. The review script includes the Mermaid definition or SVG file
reference. Sources, generated SVGs, hashes, and display metrics are retained with
the export.

Existing entry animations and transitions can be explicitly applied to diagram
scenes without changing narration timing. They affect the diagram panel or its
diagram/notes blocks, not individual SVG nodes or edges. Adding diagram support
does not insert scenes or modify existing presentations automatically.

### Opt-in animations and transitions

Do not add effects automatically. An existing scene stays static unless its
storyboard explicitly declares `animation` or `transition`; `{ "type": "none" }`
also disables that effect. When the user requests motion, choose restrained
effects for the requested scenes and preserve unrelated story and audio settings.

```json
{
  "animation": { "type": "stagger", "durationSeconds": 0.6, "staggerSeconds": 0.12 },
  "transition": { "type": "fade", "durationSeconds": 0.35 }
}
```

This excerpt adds effects to a scene, not the top-level storyboard.
Entry animations: `fade-in`, `slide-up`, `zoom-in`, and `stagger` (successive
content items). Transitions: `fade`, `wipe-left`, and `wipe-right`, revealing
the incoming scene from the previous scene's final image. Use an entry animation,
not a transition, on the opening scene.

Animation duration defaults to 0.6 seconds, transition duration to 0.35 seconds,
but only after explicit activation. Animations also accept `delaySeconds`
(default 0); `stagger` accepts `staggerSeconds` (default 0.12). Durations round
up to whole frames; delays and staggering round to the nearest frame.
All effects, including the last staggered item, must fit inside the scene's
actual narrated duration. They neither add time nor shorten adjacent scenes;
captions and narration retain their timing. Transitions never cover incoming
captions or the footer. Entry effects affect panel content, not the shared header.

The engine captures every moving frame deterministically and reuses still
images outside effect intervals. Longer effects increase rendering time and
artifact storage. The review script and render metadata retain the selections.
See the project reference for custom-template motion hooks.

For every scene, define its `keyMessage` first. Then write narration that
introduces that information naturally and connects to the preceding scene.
Keep on-screen text short; avoid abrupt imperative openings, unexplained jargon,
unverified benefits, and repetitive claims. Use an enthusiastic, natural,
professional tone without sounding like an advertisement.

Keep `"language": "en"` even when selecting a non-English voice. Store direction
in `narrationDirection`, never as spoken brackets or unsupported speech markup.
Choose a voice only from the installed list. Use `--script-only` to generate
`video/SCRIPT.md` without installing media dependencies:

```sh
node "$SKILL_DIR/scripts/generate-video.js" --project "$PROJECT_DIR" --script-only
```

Have the user approve a new narrative before the first full render, unless they
already approved it or explicitly requested autonomous generation. For iterations,
change only the requested message or media settings and directly related content.

## 4. Capture evidence, not simulations

Implement `video/capture.cjs` against the actual project using the contract.
Use Playwright for real pages and command argument arrays for real CLI output.
Keep captures and demo installations inside the render's disposable `work`
directory; isolate `HOME` where commands can read or write user resources.

Record command executables, arguments, full output, and capture provenance.
Label cropped terminal output and illustrative prompts. Never fabricate an
assistant response, claim an action ran when it did not, or expose secrets.
Local recording is a production detail, not the product's deployment model.

Inspect adapter code before executing it: it runs with normal user privileges,
not in a security sandbox. Do not run untrusted code, mutate real project/home
configuration, confirm destructive prompts, download media, or contact external
services without appropriate user authorization. Block page requests outside the
intended local origin and close contexts, servers, and child processes in `finally`.

## 5. Render and iterate

Requires macOS, Node.js 22+, and an installed voice. The bundled `package.json`
pins Playwright, FFmpeg, and Mermaid. Check dependencies first; if missing, install them
in the skill directory, not the target project's manifest:

```sh
npm --prefix "$SKILL_DIR" install
```

If Chromium is missing, use the installed Playwright CLI:

```sh
node "$SKILL_DIR/node_modules/playwright/cli.js" install chromium
```

Dependency setup downloads packages/browser binaries. Rendering itself uses
local speech, music synthesis, and FFmpeg. Python 3 is needed only if a project's
custom capture adapter uses it.
Music streams a repeating 16-bar arrangement to disk with bounded memory and
whole-track fades. It does not allocate the full soundtrack in memory.
Media-processing timeouts scale with duration instead of imposing a five-minute
processing budget on every video. Long presentations require more disk space
for retained WAV audio, frames, and captures.

```sh
node "$SKILL_DIR/scripts/generate-video.js" --project "$PROJECT_DIR" --source "$SOURCE_DIR"
```

`--source` defaults to the project directory. `--project` defaults to the current
directory. Use the real source path required by that project's adapter.
The default layout uses a small `assets/template.html` shell, paired HTML/CSS
files in `assets/templates/`, `assets/styles.css` for the shared page only,
and `assets/renderer.js` for data bindings. Keep each template's styles and
layout variants in its matching CSS file, not in the common stylesheet.
To customize one scene, copy only its HTML or CSS file to `video/templates/`
with the same name; `title.html` and `title.css` serve opening and closing cards.
`video/styles.css` is an optional global override loaded last, so existing
project-wide styles still take precedence. `video/renderer.js` can replace
the bundled bindings.
Preserve template IDs, `data-*` bindings, and `data-content` overflow markers.
The engine assembles these local files for each render without network requests.
Existing complete `video/template.html` overrides remain supported unchanged;
see the project reference before customizing the shared shell.

The skill includes its own tests and fixtures, independent of any target
storyboard. After changing its engine or templates, run:

```sh
npm --prefix "$SKILL_DIR" test
```

To also exercise actual short and 201-second video renders on macOS, with
Chromium and `Ava (Premium)` installed:

```sh
VIDEO_RENDER_TEST=1 npm --prefix "$SKILL_DIR" test
```

The render test uses disposable projects; it does not regenerate the user's
video or advance its counter. Keep product-specific capture and story tests
in the target project.

Verify the expected messages, legibility, narration, music balance, duration,
and final scene. The engine checks layout overflow and decodes the complete
MP4. Caption timing is estimated from word counts, not forced alignment.
If a check fails, fix it rather than presenting incomplete output as success.
Do not reset version counters, overwrite previous media, or remove active render
locks. Failed renders retain their named `.render-*` directory for diagnosis.

Report the resulting MP4's actual path and duration. Open it when local playback
is available and useful; never imply that an untested relative link is playable.
Keep storyboard, adapter, skill sources, and counter in Git; do not commit/push
or publish the skill to a catalog unless requested.
