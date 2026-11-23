Read this before relying on Fusion's worker containment for a sensitive task,
or when the report's Compliance, Enforcement or Containment line is unclear.

# Worker Containment

## Contents

- What containment covers
- Reading the report
- Residual shell holes
- OpenCode version boundary
- How it is enforced

## What containment covers

Fusion's containment is a harness permission allowlist, not a sandbox. It
targets two threats differently:

- **Non-adversarial drift:** a worker follows instructions found in repository
  files, web pages, or tool output, or continues agentic work beyond the panel
  task. The enforced permission map, prompt hardening, session abort, and
  recursion guard are intended to stop or shorten this class.
- **Deliberate misuse:** a worker intentionally constructs a write through an
  allowlisted shell prefix. The current default is not a complete boundary for
  this class. The watchdog can detect some consequences; OS-level sandboxing
  is the deferred boundary.

It does not prevent writes outside the workspace, changes only in gitignored
areas, or remote API side effects. Use an OS-level sandbox when a task needs
real isolation.

## Reading the report

- **Compliance tier** is derived from runtime evidence. `full` requires an
  Enforcement source of at least `harness-declared` and no policy-violation
  evidence. A watchdog mutation caps the tier at `degraded`; worker tool
  evidence that corroborates it makes the tier `non-compliant`.
- **Enforcement sources:** `verified-effective` means the effective rules were
  inspected at runtime before any model ran; `harness-declared` means the
  adapter configured an enforcement surface the harness cannot expose for
  inspection.
- **Containment** is orthogonal to the compliance tier. `no-shell`: workers
  have no shell. `allowlist-enforced`: shell is available only through the
  enforced command allowlist, which blocks ordinary drift but keeps the
  residual holes below. `sandboxed`: an OS or hosted isolation boundary
  prevents workspace writes; this is future work, not the current default. A
  `full` tier with `allowlist-enforced` containment does not mean sandboxed.
- **Workspace watchdog** compares Git status and refs (including
  remote-tracking refs) before and after the run. `mutated` findings are
  unattributed unless worker tool evidence corroborates them;
  `not-applicable` means the workspace is not a Git work tree. Edits to files
  already dirty before the run can stay `clean`, and the watchdog cannot see
  gitignored areas, writes outside the workspace, or remote side effects.
- **Instruction environment** lists the instruction layers that still reach
  workers: project and ancestor `AGENTS.md` for OpenCode, User Rules for
  Cursor. Claude Code memory and OpenCode user/global layers are blocked.
- **Denied requests** are structured tool errors: the worker keeps running and
  should disclose the denial. Denials are recorded per worker in
  `toolUseSummary.deniedRequests`.
- **Policy warnings:** unknown or unmappable tool names in the policy are
  warned and recorded, never silently ignored. Denying `bash` (or `shell`)
  removes shell entirely, reports `no-shell`, and discloses that requested
  read-only commands were discarded. Command-pattern denials such as
  `Bash(rm *)` are disclosed rather than treated as effective filters.

## Residual shell holes

The allowlist matches commands, not all shell effects. It cannot completely
exclude:

- redirection: `ls > f`;
- pipe-to-interpreter execution: `cat x | sh`;
- chaining after an allowed prefix: `git status && ...`; or
- write-capable flags: `git log --output=f`.

Effective-rule inspection proves the configured policy, not complete shell
sandboxing; the watchdog and disclosure remain necessary. Broad
metacharacter deny patterns are not used: they reject legitimate searches
such as `rg "=>"` or `rg "a|b"` and remain bypassable by deliberate
construction.

## OpenCode version boundary

The supported lines are stable OpenCode 2.0.x from 2.0.22 and any stable
2.1.x, 2.2.x, 2.3.x or 2.4.x, with 2.4.0 as the measured target. Older
versions, prereleases and unknown release lines fail explicitly before any
model call. There is no v1 adapter or OpenCode CLI transport.

On macOS, OpenCode 2.4+ matches path rules without case, so a read root also
admits every path that differs from it only in letter case. On a
case-sensitive volume those are different directories, and Fusion does not
block them. There, do not declare a read root when such a case variant holds
data workers must not read.

## How it is enforced

1. **Enforced permission map.** SDK adapters configure deny-by-default tool
   permissions, including a catch-all deny and explicit read/search/list/web and
   command-level `bash` allows. Prompts are not the permission boundary.
   `ToolsPolicy.deny` is applied after the mode-derived tool set, so denial
   always wins over defaults, explicit `allow`, and `readOnlyBashCommands`.
2. **Startup verification.** Where the harness exposes effective rules, the
   adapter verifies the required deny and allow invariants before any model
   runs. A detected failure fails that worker; the panel may continue with
   partial synthesis.
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
   than the task contract. These clauses reduce quality drift but do not
   replace technical enforcement. Experiment prompt variants omit both clauses to
   preserve condition purity. Claude Code user/project/local memory and auto
   memory are also blocked at startup via an empty `--setting-sources` list and
   `--settings '{"autoMemoryEnabled":false}'`; OpenCode SDK user/global
   instruction layers are blocked at startup through both config-directory
   redirects and removal of the explicit config-file pointer.
6. **Workspace watchdog** and **compliance disclosure**, described under
   Reading the report.
7. **Crash-safe recording.** Recorded worker artifacts are persisted
   incrementally; see `provenance.md`.

OpenCode v2 rule pre-denials surface as structured tool failures with
`error.type: "permission.rejected"`. Unexpected `permission.asked` requests
are rejected with feedback and attributed by their source tool-call id.
Denials are deduplicated, and unknown errors remain `failed`, never guessed
from human-readable message prefixes.

The OpenCode server runs authenticated `serve --stdio`; readiness and every
request authenticate. Both the local binary and actual `/api/info` identity
are checked. Before any prompt, Fusion verifies that native agent rules contain
its exact ordered rules beginning with its catch-all deny, including declared
read roots and the no-tools judge, followed by nothing or only deny rules.
Earlier inherited defaults are shadowed by that reset. Appended denies (for
example OpenCode 2.0.21+'s `browser:*` deny) can only narrow the last-match
policy and are disclosed in notes; an appended allow or ask fails closed.
Asynchronous agent initialization is awaited, not treated as permission to
skip verification. Native actions map portable `bash` to `shell` and
recursive delegation to `subagent`. The `sdk` label denotes the structured
REST/SSE machine protocol, not a runtime npm dependency.

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

Unknown tool names use the strict parity check uniformly across adapters,
without treating OpenCode's catch-all denial as a verifiability exception:
strict parity fails only if the capability is still effective after mode and
profile floors.

Cursor adds only verified config grammar (`Shell(**)`, `Read(**)`, and
`Write(**)`) to its immutable profile floor. It does not map `Grep`, `Glob`, or
`LS` to the broader `Read(**)` permission. A run-scoped, fail-closed
`preToolUse` hook enforces the remaining canonical tool-name denials, and Bash
denial also empties the shell hook allowlist. Observation of tool results is a
separate best-effort surface and its limitations remain disclosed.
