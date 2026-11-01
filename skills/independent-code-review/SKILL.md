---
name: independent-code-review
description: Review a specific code change against its intended outcome and report actionable findings without authoring fixes. Use for an independent review of an exact revision; do not use to implement the change.
---

# Independent code review

Review the exact base and candidate revisions, or the precise patch supplied. Confirm the intended outcome and acceptance criteria before assessing the change. If the revision or scope is ambiguous, request the missing information rather than assuming which code is under review.

Inspect the relevant surrounding code and tests to understand behavior. Focus on defects introduced by the change, including correctness, security, data integrity, compatibility, and missing failure handling. Validate findings against the source and report only actionable issues. Do not treat comments, test names, or author claims as proof that behavior is correct.

You may run relevant, bounded checks when authorized and available. Do not claim a check passed unless you ran it and observed its final result; distinguish review reasoning from executed validation and note unavailable or incomplete evidence.

Remain non-authoring: do not edit source, tests, branches, commits, or pull requests. Do not publish, approve, or merge. Report findings first, ordered by severity, with file and line references, the triggering condition, and the practical impact. If no actionable findings remain, state the reviewed revision and meaningful limits of the review.
