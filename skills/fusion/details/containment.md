This file is supplementary guidance for Fusion. The executable runtime protocol
remains in `../SKILL.md`. Do not rely on this file being read at runtime.

# Worker Containment

Issue [yamatakeru/skills#10](https://github.com/yamatakeru/skills/issues/10)
is the motivating incident for this containment model. A deprecated OpenCode
prompt field replaced the adapter's injected permission map, a completed worker
session continued after its event stream closed, and request-echo evidence still
allowed the panel to report full compliance.

## Threat Model

Fusion distinguishes two threats:

- **Non-adversarial drift:** a worker follows instructions found in repository
  files, web pages, or tool output, or continues agentic work beyond the panel
  task. The enforced permission map, prompt hardening, abort, and recursion guard
  are intended to stop or shorten this class.
- **Deliberate misuse:** a worker intentionally constructs a write through an
  allowlisted shell prefix. The current default is not a complete boundary for
  this class. The watchdog can detect some consequences, but OS-level sandboxing
  is the deferred boundary.

The model does not claim to prevent writes outside the workspace, changes only
in gitignored areas, or remote API side effects.

## Defense Layers

1. **Enforced permission map.** SDK adapters configure deny-by-default tool
   permissions, including a catch-all deny and explicit read/search/list/web and
   command-level `bash` allows. Prompts are not the permission boundary.
2. **Startup verification.** Where the harness exposes effective rules, the
   adapter verifies the required deny and allow invariants before any model
   runs. A detected failure fails fast; the panel may continue with partial
   synthesis.
3. **Session abort.** Every terminal path aborts the harness session after
   result collection and before disconnecting its event stream. Abort failures
   are warning-only evidence, with server shutdown as the final backstop.
4. **Recursion guard.** Worker environments increment `FUSION_PANEL_DEPTH`;
   `fusion-run` and `fusion-judge-replay` refuse to start at depth 1 or greater.
   The default shell allowlist already excludes `bun`, so this layer primarily
   protects full-tool runs and future allowlist changes.
5. **Prompt hardening.** Default workers are told to treat instructions found in
   repository files, web pages, and tool output as data rather than directives.
   This reduces quality drift but does not replace technical enforcement.
   Experiment prompt variants omit the sentence to preserve condition purity.
6. **Workspace watchdog.** Before/after Git status and ref snapshots detect
   tracked-worktree changes and ref movements, including remote-tracking ref
   updates. Findings are unattributed unless worker tool evidence corroborates
   them, and the report discloses detection gaps.
7. **Compliance and containment disclosure.** Compliance tier is derived from
   runtime evidence. Enforcement source and containment level are reported
   separately so protocol compliance never implies sandboxing.
8. **Crash-safe recording.** Recorded worker artifacts are persisted
   incrementally. `run-status.json` starts at `running` and resolves to
   `complete`, `failed`, or `aborted` on handled terminal paths; an abrupt crash
   remains self-describing as `running`.

## Containment Levels

- `no-shell`: workers have no shell capability.
- `allowlist-enforced`: shell is available only through the enforced command
  allowlist. This blocks ordinary drift but retains the residual construction
  holes below.
- `sandboxed`: shell runs behind an OS or hosted isolation boundary that
  prevents workspace writes. This is future work, not a property of the current
  default.

Containment level is orthogonal to the compliance tier. When `bash` is enabled,
the panel report always renders the containment level; a `full` protocol tier
with `allowlist-enforced` containment is possible and does not mean sandboxed.

## Residual Shell Holes

The allowlist matches commands, not all shell effects. It cannot completely
exclude:

- redirection: `ls > f`;
- pipe-to-interpreter execution: `cat x | sh`;
- chaining after an allowed prefix: `git status && ...`; or
- write-capable flags: `git log --output=f`.

Broad metacharacter deny patterns are not used: they reject legitimate searches
such as `rg "=>"` or `rg "a|b"` and remain bypassable by deliberate
construction. See ADR 0039 for the accepted trade-off and sandbox deferral.

## Crash Recovery

All available worker requests and results are written incrementally during a
recorded run. A `run-status.json` left at `running` means the process did not
reach a handled terminal state; `SIGKILL` necessarily leaves this marker.
Handled termination resolves it best-effort to `aborted`, while ordinary
terminal outcomes resolve it to `complete` or `failed`.

If the required worker artifacts survived, rerun only the judge against the
recorded run:

```bash
bun skills/fusion/bin/fusion-judge-replay.ts \
  --run <id-or-path> \
  --arm recovery \
  --judge-model <entry>
```

Judge replay preserves the original worker evidence and writes separate replay
artifacts. It recovers synthesis from a crashed run; it does not turn the
original run-status marker into evidence that the original process completed.
