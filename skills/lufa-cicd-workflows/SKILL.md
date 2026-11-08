---
name: lufa-cicd-workflows
description: Create or modify GitHub Actions workflows for grasdouble projects. Consult the Lufa-CICD composite-action catalogue and reuse a suitable published action when it fits; use native workflow steps when no catalogue action covers the requirement.
---

# Lufa-CICD workflow authoring

When creating or changing a GitHub Actions workflow in a `grasdouble` project, inspect the current [Lufa-CICD catalogue](https://github.com/grasdouble/Lufa-CICD) before designing the job steps. Prefer an existing composite action when it covers the requested behavior without changing the workflow's intended behavior. Do not force an action onto a task it does not fit; keep project-specific commands and unsupported behavior in ordinary workflow steps.

## Workflow

1. Inspect the consumer repository's existing workflows, package manager, release setup, and conventions. Read the relevant action's current README and `action.yml` in Lufa-CICD; do not rely only on the summary below.
2. Match each requested responsibility to the catalogue. Current components include:
   - `lint-workflows`: workflow validation.
   - `setup-node-pnpm`: Node.js, pnpm, caching, and registry authentication.
   - `pr-comment`: author-scoped marked pull-request comments.
   - `check-changesets`: Changeset coverage checks.
   - `dependabot-changeset`: Changeset generation for Dependabot pull requests.
   - `check-quality`: run caller-selected quality commands.
   - `dependency-report`: dependency report summary and artifact.
   - `sync-agents`: check or synchronize shared `AGENTS.md` rules.
   - `ftp-deploy`: FTP/FTPS deployment of a prepared directory.
   - `changesets-release`: pnpm package release pipeline.
3. Use the documented action path and version reference for the chosen component, for example `grasdouble/Lufa-CICD/actions/lint-workflows@lint-workflows-v1` when that alias is published. If the alias or a required version is not available, inspect the repository's release/versioning guidance and use a verified published ref. Never invent a tag, input, output, permission, or default.
4. Keep caller-owned workflow concerns explicit: triggers, runner, checkout, job permissions, environment, concurrency, matrix, and timeouts. Grant only the permissions documented as necessary by the caller's job and the selected action. Pass secrets only through documented inputs and explicit expressions.
5. Preserve repository-specific behavior. Explain any requested step that remains native because the catalogue has no fitting action. Do not replace an existing project pipeline with the release action unless the project uses its supported pnpm/Changesets setup and the requested behavior matches.
6. Validate the workflow with an available workflow linter or the repository's documented validation command. Report checks actually run and any validation limitation.

## Guardrails

- Composite actions are called from `jobs.<job>.steps`; they do not replace reusable workflow syntax or define caller triggers and job permissions.
- A `uses: ./...` path refers to the consumer repository checkout, not the Lufa-CICD repository. Use a remote, versioned reference to consume catalogue actions.
- Check action documentation for required inputs, supported runners, nested action references, and required permissions before use.
- Prefer a stable major alias for routine consumption when published. Use an exact version or full commit SHA when the repository's policy requires pinning; verify the reference exists.
- If no catalogue action fits, implement the workflow with appropriate native actions and commands rather than introducing unrelated catalogue steps.
