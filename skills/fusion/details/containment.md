This file is supplementary guidance for Fusion. The executable runtime protocol
remains in `../SKILL.md`. Do not rely on this file being read at runtime.

# Worker Containment

Issue [yamatakeru/skills#10](https://github.com/yamatakeru/skills/issues/10)
is the motivating incident for this containment model. A deprecated OpenCode
prompt field replaced the adapter's injected permission map, a completed worker
session continued after its event stream closed, and request-echo evidence still
allowed the panel to report full compliance.

Issue [yamatakeru/skills#11](https://github.com/yamatakeru/skills/issues/11)
confirmed that deprecated agent-level `tools` also corrupts effective rule
ordering during OpenCode v1 normalization. The v2-only SDK transport uses native
ordered `permissions` rules as the sole authority (ADR 0046); the historical v1
workarounds and deprecated `tools` toggles are not carried forward.

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
   repository files, web pages, and tool output as data rather than directives,
   and persistent harness-injected instructions as environment context rather
   than the task contract. These items 8-9 reduce quality drift but do not
   replace technical enforcement. Experiment prompt variants omit both items to
   preserve condition purity. Claude Code user/project/local memory and auto
   memory are also blocked at startup via an empty `--setting-sources` list and
   `--settings '{"autoMemoryEnabled":false}'`; OpenCode SDK user/global
   instruction layers are blocked at startup through both config-directory
   redirects and removal of the explicit config-file pointer; OpenCode project
   and ancestor `AGENTS.md` and Cursor User Rules remain standing disclosed
   inputs (ADR 0043/0045/0046).
6. **Workspace watchdog.** Before/after Git status and ref snapshots detect
   tracked-worktree changes and ref movements, including remote-tracking ref
   updates. Findings are unattributed unless worker tool evidence corroborates
   them, and the report discloses detection gaps.

   OpenCode v2 rule pre-denials surface as structured tool failures with
   `error.type: "permission.rejected"`. Unexpected `permission.asked` requests
   are rejected with feedback and attributed by their source tool-call id.
   Denials are deduplicated, and unknown errors remain `failed`, never guessed
   from human-readable message prefixes.
7. **Compliance and containment disclosure.** Compliance tier is derived from
   runtime evidence. Enforcement source and containment level are reported
   separately so protocol compliance never implies sandboxing.
8. **Crash-safe recording.** Recorded worker artifacts are persisted
   incrementally. `run-status.json` starts at `running` and resolves to
   `complete`, `failed`, or `aborted` on handled terminal paths; an abrupt crash
   remains self-describing as `running`.

## OpenCode Version Boundary

The supported line is stable OpenCode 2.0.x from 2.0.12, with 2.0.12 as the
measured target (ADR 0046). Older versions, prereleases and unknown release
lines fail explicitly. There is no v1 adapter or OpenCode CLI transport.
The `sdk` label denotes the structured REST/SSE machine protocol, not a runtime
npm dependency; `@opencode/client` is pinned for type-only imports.

The owned server runs authenticated `serve --stdio`; readiness and every
request authenticate. Both the local binary and actual `/api/info` identity
are checked. Before any prompt, Fusion verifies the exact ordered suffix of
native agent rules beginning with its catch-all deny, including declared read
roots and the no-tools judge. Earlier inherited defaults are shadowed by that
reset. Asynchronous agent initialization is awaited, not treated as permission
to skip verification. Native actions map portable `bash` to `shell` and
recursive delegation to `subagent`.

SSE must confirm `server.connected` before prompt admission. Only terminal
execution success completes the worker; a prompt response or tool step does
not. Every terminal path requests interrupt before aborting the stream. An
idle `interrupted:false` response is a successful cleanup no-op. Stream loss
fails rather than attempting replay of a live-only event feed. Externally
injected servers require explicit authentication and version/rule checks but
cannot claim Fusion-controlled startup isolation and are never killed.

Web search selects Exa in the run-scoped config with the owner's consent. This
avoids v2's interactive first-use provider form without changing persisted user
settings or silently sending queries to a different provider.

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

`ToolsPolicy.deny` is applied after the mode-derived tool set, so denial always
wins over defaults, explicit `allow`, and `readOnlyBashCommands`. Denying
`bash` or its `shell` alias removes shell entirely, reports `no-shell`, empties
the command allowlist, and discloses that any requested read-only commands were
discarded. Unknown or adapter-unmappable names are never silently ignored:
they are warned and recorded in compliance evidence, while strict parity fails
only if the capability is still effective after mode and profile floors.
Unknown names use this strict check uniformly across adapters, without treating
OpenCode's catch-all denial as a verifiability exception.

Cursor adds only verified config grammar (`Shell(**)`, `Read(**)`, and
`Write(**)`) to its immutable profile floor. It does not map `Grep`, `Glob`, or
`LS` to the broader `Read(**)` permission. A run-scoped, fail-closed
`preToolUse` hook enforces the remaining canonical tool-name denials, and Bash
denial also empties the shell hook allowlist. Observation of tool results is a
separate best-effort surface and its limitations remain disclosed. OpenCode's
former degraded headless CLI transport was removed by ADR 0046.

Tool-name policy does not support command-pattern denials such as
`Bash(rm *)`; such entries are disclosed rather than treated as effective
command filters.

## Residual Shell Holes

The allowlist matches commands, not all shell effects. It cannot completely
exclude:

- redirection: `ls > f`;
- pipe-to-interpreter execution: `cat x | sh`;
- chaining after an allowed prefix: `git status && ...`; or
- write-capable flags: `git log --output=f`.

Historical v1 measurements of subcommand parsing are not a v2 containment
guarantee. Fusion's command-pattern rules do not themselves parse every shell
effect, so chaining, redirection and write-capable flags remain residual risks.
Effective-rule inspection proves the configured policy, not complete shell
sandboxing; the watchdog and disclosure remain necessary.

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
