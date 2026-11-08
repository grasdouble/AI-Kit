# Shared instruction authoring

Use `instructions/` for guidance intended to be reused across repositories or shared with other contributors. Keep repository-specific policy in repository-local guidance and link to shared instructions where appropriate.

1. Define the instruction's purpose, intended audience, applicable tasks, and scope. Make clear when it should and should not be loaded.
2. Write portable, actionable guidance. Do not assume a particular repository layout, tool, dependency, product behavior, or permission unless the instruction targets that environment; state prerequisites and applicability explicitly.
3. Prefer observable requirements and decision rules over broad aspirations. Address important boundaries, failure cases, and conflicts without trying to prescribe unrelated work.
4. Build on authoritative shared policy rather than copying it. Reference the source when needed, and avoid unnecessary chains of instructions that force consumers to load unrelated material.
5. Follow the target consumer's documented format, discovery, and precedence rules. Do not infer those requirements from experimental or repository-local examples.
6. Validate instructions against representative scenarios, including edge cases and out-of-scope tasks. Check that examples and links are valid, the guidance is internally consistent, and consumers can follow it without unsupported tools or authority.
7. Keep guidance maintainable: avoid duplicated rules, remove obsolete references, and revisit any external or environment-specific claims when their source changes.
