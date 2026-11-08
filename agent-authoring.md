# Agent authoring instructions

1. Define the agent's purpose, intended use, and boundaries. Give it a distinct responsibility; do not create a second general-purpose assistant or overlap another role without a clear handoff.
2. Specify only what the agent needs to perform that role: required inputs and outputs, workflow, decision authority, available tools, and verification or escalation requirements. Never promise capabilities, access, or guarantees the runtime does not provide.
3. Follow the target agent runtime's documented format and loading behavior. Treat required metadata, file naming, and directory placement as an integration contract, not a stylistic choice; do not infer that contract from experimental profiles in this repository.
4. Keep instructions operational and focused. Reuse applicable shared guidance by reference rather than copying it, and avoid repository facts that can become stale unless they are essential to the role.
5. Evaluate the profile against representative tasks, including an ambiguous or out-of-scope case. Confirm that it enables the intended work, respects its authority boundary, produces useful handoffs, and does not conflict with higher-priority instructions.
6. Update any routing, configuration, or references that make the profile discoverable. Remove references to renamed or retired profiles.
