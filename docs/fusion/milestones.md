# Fusion Reserved Milestones (number registry)

Merged ADRs cite reserved milestones by number (ADR 0026/0028/0029/0030/
0042 among others), so the number-to-meaning mapping is an immutable
determination and lives in-repo per the AGENTS.md documentation policy.
This registry defines the numbers; live progress is tracked in the
fusion backlog issue (#20). Numbers are never reused or renumbered.

| # | Meaning | Defining/consuming records | Status |
|---|---|---|---|
| 0 | Cursor harness round (probe, adoption, hooks enforcement) | ADR 0030-0032, 0034; PR #3/#4 | DONE (2026-07-08) |
| 1 | SDK transport with tool-policy proof and programmatic permission handling | ADR 0028 | DONE (2026-07-06) |
| 2 | CI automation of the smoke matrix plus flag-contract regression probes (needs credential management and paid calls in CI) | ADR 0030, 0042; spec acceptance criteria | reserved |
| 3 | Consider removing the emergency internal fallback | ADR 0017 | reserved |
| 4 | Revisit the portable-worker-instructions trade-off against upstream fidelity | ADR 0020 | reserved |
| 5 | Judge-quality comparison round (judge vs parent-agent synthesis, measured); the mandatory input for the ADR 0026 judge-tools re-decision (tools-on / tools-off / tool-free-grounding arms) | ADR 0026, 0028, 0030 | reserved (the ADR 0026 re-decision duty is live) |
| 6 | Durable fix for the permission-abort worker dropout class | ADR 0029 | DONE (2026-07-06) |

Unnumbered deferred candidates from the default-composition round are
recorded in ADR 0041 (decision record) and issue #15 (closed); they are
filed as issues when a concrete need appears.
