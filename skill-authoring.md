# Skill authoring instructions

1. Identify repeated, mechanical, deterministic steps in the skill workflow. When a runnable script bundled with the skill would make those steps more reproducible and reduce repeated model instructions, implement them as a script. Do not turn every task into a script: keep semantic judgment, user interaction, and genuinely variable decisions in the instructions.
2. Explain when and how to invoke each bundled script, its inputs and outputs, prerequisites, and failure behavior. Keep invocation paths and examples accurate for the actual scripts; do not duplicate a script's full procedure in prose.
3. Validate script inputs and report actionable errors for invalid or unsupported inputs. Do not silently guess or substitute values.
4. Prefer dependencies and runtime patterns already used by the repository or available in the skill's runtime. Avoid adding a dependency when the available runtime suffices. Follow existing script language and packaging conventions rather than imposing a new one.
5. When applicable, validate scripts against representative success and invalid-input or failure cases. Ensure the instructions' examples and invocation paths match the bundled scripts.

## Repository examples

- [`skills/github-project-management/SKILL.md`](skills/github-project-management/SKILL.md) documents a concise bundled wrapper, its prerequisites, invocation, supported operations, and examples.
- [`skills/create-presentation-video/SKILL.md`](skills/create-presentation-video/SKILL.md) documents a larger set of bundled scripts and their invocation in context.
