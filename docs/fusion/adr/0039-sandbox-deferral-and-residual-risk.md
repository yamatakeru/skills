# ADR 0039: Defer OS Sandboxing and Accept Disclosed Residual Shell Risk

## Status

Accepted

## Context

With `bash` enabled, complete write prevention cannot be achieved by matching
the command string against allowed prefixes. An allowed read command can be
turned into a write or an execution chain without changing its allowed prefix.
Concrete residual hole classes include:

- output redirection, such as `ls > f`;
- piping into an interpreter, such as `cat x | sh`;
- command chaining, such as `git status && ...`; and
- write-capable flags on nominally investigative commands, such as
  `git log --output=f`.

OpenCode v1.17.20's shell tool substantially mitigates the chaining class by
evaluating each `&&`- or `;`-separated subcommand as its own permission pattern.
This is a version-specific implementation detail, not a Fusion rule guarantee,
and must not be treated as a boundary on which containment depends.

Adding deny patterns such as `* > *` was considered. It would reject legitimate
search expressions such as `rg "=>"` and regex alternation such as `a|b`, while
a deliberately constructed command could still bypass finite pattern checks.
The mitigation would reduce the investigation capability that the allowlist
exists to preserve without establishing a security boundary.

## Decision

Pattern-based deny mitigation for these hole classes is rejected. The enforced
allowlist is useful against non-adversarial drift, but it is not described as
safe against deliberate shell construction.

`bash` remains part of the read-only default. Removing it would sacrifice git
history investigation, the core capability restored by ADR 0022, even though
the remediation now makes the allowlist itself effective. That loss of worker
expressiveness is not accepted in this wave.

Complete write prevention is deferred to an OS-level sandbox milestone. That is
a design project rather than a command-filter patch: the current shared server
model would need per-worker server separation, the workspace should be mounted
or governed read-only while harness state remains selectively writable, and the
available mechanisms differ between macOS and Linux. Upstream OpenRouter Fusion
solves the same problem with a hosted sandbox, which is an infrastructure
boundary rather than pattern matching.

The residual risk is accepted only with the compensating controls from ADR
0038: the workspace watchdog and always-on containment disclosure for
shell-enabled runs.

## Consequences

The default panel preserves git-history and shell-based investigation while
preventing the ordinary out-of-policy commands involved in issue #10. It does
not promise complete filesystem immutability or resistance to a worker that
intentionally constructs a write through an allowed prefix.

Maintainers must not infer "safe" from the existence of an allowlist. Reports
must say `allowlist-enforced` until a real sandbox boundary exists, and the
watchdog's detection gaps remain visible. The future sandbox milestone can add
`sandboxed` containment without redefining protocol compliance.
