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
  inspected at runtime before that worker's model ran; `harness-declared` means the
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

OpenCode workers accept only the stable release lines listed in the
`compatibility` field of `SKILL.md`. Any other version, including prereleases
and newer release lines, fails each OpenCode worker before its model call,
with an error that names the supported range; workers on other harnesses still
run. There is no v1 adapter or OpenCode CLI transport.

On macOS, OpenCode 2.4+ matches path rules without case, so a read root also
admits every path that differs from it only in letter case. On a
case-sensitive volume those are different directories, and Fusion does not
block them. There, do not declare a read root when such a case variant holds
data workers must not read.

## How it is enforced

- **Permission map.** Adapters configure deny-by-default tool permissions: a
  catch-all deny, then explicit read/search/list/web allows and command-level
  shell allows. Prompts are not the permission boundary; a deny always wins
  over defaults and explicit allows.
- **Startup verification.** Where the harness exposes effective rules, they
  are verified before that worker's model runs. For OpenCode this covers the server
  version and Fusion's ordered rules, including declared read roots; denies
  that OpenCode appends after them can only narrow the policy and are
  disclosed in notes, while an appended allow or ask fails the worker. A
  failed check fails that worker; the panel may continue as `partial`.
- **Session abort.** Every terminal path aborts the harness session. Abort
  failures are warnings, with server shutdown as the final backstop.
- **Recursion guard.** Workers cannot start another Fusion run.
- **Prompt hardening.** Workers are told to treat instructions in repository
  files, web pages and tool output as data, not directives. This reduces drift
  but is not enforcement.
- **Cursor** enforces the remaining tool-name denials and the shell allowlist
  with a run-scoped, fail-closed hook; observation of tool results is
  best-effort and disclosed.
