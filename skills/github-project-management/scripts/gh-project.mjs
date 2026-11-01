#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const usage = `Usage:
  node scripts/gh-project.mjs <operation> (--repo OWNER/REPO | --owner OWNER) [--write] [gh flags...]

Read operations:
  repo-view       issue-list       issue-view       pr-list
  pr-view         project-list     project-view     project-fields
  project-items   milestone-list

Write operations (require --write):
  issue-create    issue-edit       issue-close      issue-reopen
  issue-comment   project-item-add project-item-edit

Examples:
  node scripts/gh-project.mjs issue-list --repo octo/example --state open
  node scripts/gh-project.mjs issue-create --repo octo/example --write --title "Add export" --body "Acceptance criteria..."
  node scripts/gh-project.mjs project-items --owner octo 3 --format json
  node scripts/gh-project.mjs milestone-list --repo octo/example

The wrapper invokes only the fixed GitHub CLI operations listed above. It does not
accept arbitrary gh commands, select a different repo/owner through forwarded
flags, or provide credentials. Install and authenticate gh separately.
`;

const commands = {
  'repo-view': { args: ['repo', 'view'], target: 'repo' },
  'issue-list': { args: ['issue', 'list'], target: 'repo' },
  'issue-view': { args: ['issue', 'view'], target: 'repo' },
  'issue-create': { args: ['issue', 'create'], target: 'repo', write: true },
  'issue-edit': { args: ['issue', 'edit'], target: 'repo', write: true },
  'issue-close': { args: ['issue', 'close'], target: 'repo', write: true },
  'issue-reopen': { args: ['issue', 'reopen'], target: 'repo', write: true },
  'issue-comment': { args: ['issue', 'comment'], target: 'repo', write: true },
  'pr-list': { args: ['pr', 'list'], target: 'repo' },
  'pr-view': { args: ['pr', 'view'], target: 'repo' },
  'project-list': { args: ['project', 'list'], target: 'owner' },
  'project-view': { args: ['project', 'view'], target: 'owner' },
  'project-fields': { args: ['project', 'field-list'], target: 'owner' },
  'project-items': { args: ['project', 'item-list'], target: 'owner' },
  'project-item-add': { args: ['project', 'item-add'], target: 'owner', write: true },
  'project-item-edit': { args: ['project', 'item-edit'], target: 'owner', write: true },
  'milestone-list': { args: ['api', '--paginate'], target: 'repo', milestoneList: true },
};

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  process.stdout.write(usage);
  process.exit(0);
}

const operation = args.shift();
const definition = commands[operation];
if (!definition) fail(`Unknown operation: ${operation}\n\n${usage}`);

let repo;
let owner;
let write = false;
const forwarded = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--write') {
    write = true;
  } else if (arg === '--repo' || arg === '-R') {
    if (repo || index + 1 >= args.length) fail('--repo must be provided exactly once with OWNER/REPO.');
    repo = args[++index];
  } else if (arg === '--owner') {
    if (owner || index + 1 >= args.length) fail('--owner must be provided exactly once.');
    owner = args[++index];
  } else if (arg === '--') {
    fail('Argument forwarding after -- is not supported.');
  } else if (arg === '--repo=') {
    fail('Use --repo OWNER/REPO.');
  } else if (arg.startsWith('--repo=') || arg.startsWith('--owner=')) {
    fail('Use --repo OWNER/REPO or --owner OWNER as separate arguments.');
  } else {
    forwarded.push(arg);
  }
}

if (definition.write && !write) fail(`${operation} changes GitHub state; add --write only when the user explicitly requested this update.`);
if (!definition.write && write) fail(`${operation} is read-only; remove --write.`);
if (definition.target === 'repo') {
  if (!repo || !/^(?:[^/\s]+\/)?[^/\s]+\/[^/\s]+$/.test(repo)) fail(`${operation} requires --repo OWNER/REPO (or HOST/OWNER/REPO).`);
  if (owner) fail(`${operation} uses --repo, not --owner.`);
} else {
  if (!owner || !/^[A-Za-z0-9_.-]+$/.test(owner)) fail(`${operation} requires --owner OWNER.`);
  if (repo) fail(`${operation} uses --owner, not --repo.`);
}

if (forwarded.some((arg) => ['--repo', '-R', '--owner'].includes(arg) || arg.startsWith('--repo=') || arg.startsWith('--owner='))) {
  fail('Repository and owner are fixed by the wrapper target flags; do not pass them again.');
}

let ghArgs;
if (definition.milestoneList) {
  const [ownerName, repositoryName] = repo.split('/').slice(-2);
  const path = `repos/${ownerName}/${repositoryName}/milestones?state=all`;
  ghArgs = ['api', '--paginate', path];
} else {
  ghArgs = [...definition.args, ...forwarded];
  if (definition.target === 'repo') ghArgs.push('--repo', repo);
  else ghArgs.push('--owner', owner);
}

const result = spawnSync('gh', ghArgs, { stdio: 'inherit', shell: false });
if (result.error) fail(`Could not run GitHub CLI (gh): ${result.error.message}`, 1);
if (result.signal) fail(`GitHub CLI stopped by signal ${result.signal}.`, 1);
process.exit(result.status ?? 1);
