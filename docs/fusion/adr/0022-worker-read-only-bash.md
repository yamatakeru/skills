# ADR 0022: Default Worker Tools Include Read-Only Bash

## Status

Accepted

Amends ADR 0018 and ADR 0006.

## Context

The original OpenCode subagent Fusion auto-approved a read-only bash
allowlist for panelists (`git status`, `git diff`, `git log`, `rg`, `grep`,
`ls`, `cat`, `sed`), and this was one of its main investigation levers. The
current claude-code adapter allows only `Read,Grep,Glob,LS,WebSearch,WebFetch`,
leaving git history unreachable. ADR 0020 adds prompt-level tool-use
encouragement, which is empty without the corresponding capability.

## Decision

The default worker tool policy includes a read-only bash command allowlist
mirroring the OpenCode version: git inspection (`git status`, `git diff`,
`git log`) plus read-only search and listing commands. All other bash remains
denied; edit, write, destructive commands, and recursive delegation stay
denied per ADR 0006/0011/0018.

`sed` is deliberately excluded from the reference default even though the
OpenCode original allowed it: allowlist enforcement is prefix-pattern based
(`Bash(<command>:*)`), which cannot distinguish read-only stream editing from
`sed -i` in-place writes, so admitting `sed` would silently break the
read-only guarantee. Its read-only uses are covered by `rg`, `grep`, and
`cat`.

Enforcement is per-harness. The claude-code adapter grants Bash restricted to
the allowlist patterns, with headless deny (`dontAsk`) rejecting everything
outside it. The opencode adapter still cannot enforce tool policy at all;
that remains the known degraded-compliance evidence, and the in-panel parity
difference is recorded per ADR 0006 rather than blocking the panel.

## Consequences

Workers regain investigation parity with the original OpenCode panelists,
most importantly git history access. The attack surface grows slightly and is
bounded by allowlist-only enforcement; compliance evidence must record the
effective policy so audits can verify the boundary. ADR 0018's web-access
defaults are unchanged.
