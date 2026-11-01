---
name: conventional-commits
description: Write, review, or improve commit messages that follow Conventional Commits 1.0.0. Use when asked to prepare a commit message, check commit-message compliance, or make an explicitly requested commit using this standard.
---

# Conventional Commits

Write clear commit messages that follow the [Conventional Commits 1.0.0 specification](https://www.conventionalcommits.org/en/v1.0.0/).

## Message format

Use this structure:

```text
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

- `type` is required and names the kind of change. Common choices include `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`. The specification does not prescribe a closed list.
- `scope` is optional. Use a concise noun in parentheses to identify the affected area, for example `fix(api): handle expired tokens`.
- `!` immediately before `:` marks a breaking change, for example `feat(api)!: remove the v1 endpoint`.
- The description is required and follows the colon and one space. Keep it concise and specific to the change.
- Separate a body from the header with a blank line. Use the body to explain the motivation or relevant context, not to repeat the description.
- Add footers after a blank line. A footer uses a token followed by `: ` or ` #`, for example `Refs: #42`.
- A breaking change can be marked with `!` in the header, a `BREAKING CHANGE: ` footer, or both. The footer describes the breaking change.

## Workflow

1. Inspect the relevant staged or unstaged diff and identify the change's intent. Do not infer details that are not supported by the changes.
2. Choose the most accurate type; add a scope only when it helps identify the affected area.
3. Mark a breaking change with `!` or a `BREAKING CHANGE: ` footer when the change breaks compatibility. Do not mark a change as breaking merely because it is substantial.
4. Produce the message in the requested language. Keep the type and footer tokens in their Conventional Commits form.
5. If the change or its impact is unclear, ask for the missing context instead of inventing it.
6. When asked to review a message, explain any format issue and provide a corrected version.
7. Do not create a Git commit unless the user explicitly asks you to commit.

## Examples

```text
feat(search): add filtering by repository

fix: avoid retrying requests after cancellation

docs(readme): clarify local installation steps

feat(api)!: require an access token

BREAKING CHANGE: API requests without an access token are rejected.
```

The examples illustrate the format; type names, scopes, and descriptions should match the actual change. Capitalization, punctuation, and imperative phrasing are conventions a project may choose, not requirements imposed by the Conventional Commits specification.
