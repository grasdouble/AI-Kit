# Testing instructions

1. Inspect the implementation and existing test conventions before designing tests.
2. Test consumer-visible behavior, including meaningful boundaries, invariants, transitions, precedence, and error cases.
3. Keep tests deterministic, isolated, and safe for the full suite.
4. Do not pin wording, source text, forwarding, wiring, incidental defaults, or other implementation details that do not express a user-visible contract.
5. For reported bugs, reproduce the failure before the fix where practical, then verify the changed path after the fix.
6. Report the exact commands run and observed results; distinguish tests from runtime smoke checks.
