# ADR 0045: Startup Injection Blocking Profiles

## Status

Accepted

Decided 2026-08-07 from a grilled session plus the instruction-environment
probe round (P2-1, issue #17), run under the ADR 0034 mandatory
restore-to-pristine constraint: every probed user-global file
(`~/.claude/CLAUDE.md`, `~/.config/opencode/opencode.json`,
`~/.config/opencode/AGENTS.md` pristine-absent) was proven byte-identical
to its pre-probe snapshot after each marker window and at round close.
Probe transcripts, leg matrix, and restore proofs live in the probe job
directory (`.fusion-runs/probe-2026-08-07-instruction-env/`,
entry point `probe-summary.md`) and are summarized in
`FUSION_RUNTIME_HANDOFF.md`. Completes the blocking phase reserved by
ADR 0043; disclosure mechanics from ADR 0043 are unchanged.

## Context

ADR 0043 standardized capability-level Instruction Environment disclosure
and deferred startup blocking to a probe round. The probes used synthetic
passive marker tokens planted by the round itself; detecting them is not
the runtime existence-detection of user-injected content whose recording
ADR 0043 prohibits — no user-injected instruction content appears in the
probe artifacts (probe prompts requested marker lines or NONE only).

Probed findings, all live-verified:

- **Claude Code `--setting-sources` (user/project/local).** User memory
  (`~/.claude/CLAUDE.md`) loads iff `user` OR `project` is listed;
  excluding `user` alone does not suppress it. Project memory (cwd
  `CLAUDE.md`) loads iff `project` is listed. Both layers are suppressed
  only by `--setting-sources local` (or the accepted empty list). With
  faithful panel worker and judge argv plus `--setting-sources local`,
  tools, the Bash allowlist, permission mode, and the judge no-tools JSON
  contract all behaved normally.
- **OpenCode `--pure` is plugins-only on both paths.** Global
  `~/.config/opencode/AGENTS.md` markers reached CLI `run --pure`
  sessions and `serve --pure` sessions alike, matching the help text
  ("run without external plugins"). This narrows the ADR 0043-era
  wording "suppression effect unverified" to a verified negative.
- **`OPENCODE_CONFIG_CONTENT` merges with user config, it does not
  replace it.** Global rule files and user-config `instructions` files
  both reached serve sessions started with the adapter's faithful config
  content.
- **A config-directory redirect blocks the opencode serve path.**
  Pointing `XDG_CONFIG_HOME` at an empty scratch directory in the serve
  spawn env blocked both the user-config `instructions` channel and the
  global rule-file channel (marker probe returned NONE) with auth and
  operation intact — opencode credentials live outside the config
  directory. A marker placed inside the redirect target injected,
  proving the redirect target is honored rather than silently ignored.
  The project layer (cwd `AGENTS.md`) is cwd-scoped, not config-scoped,
  and still injects under the redirect.
- **The opencode CLI path has no viable blocking mechanism.** `opencode
  run` hung with zero output under either redirect env
  (`XDG_CONFIG_HOME`, `OPENCODE_CONFIG`) even against a pristine config,
  and independently hung whenever an `instructions` key was present in
  `opencode.json` (4/4, with and without `--pure`,
  instructions-file-path independent), while serve succeeded on every
  equivalent leg.

Post-review follow-up probes (2026-08-07, PR #19 review finding), all
scratch-scoped and live-verified:

- `--setting-sources local` also loads `CLAUDE.local.md` from the
  session cwd AND the per-project auto-memory file
  (`~/.claude/projects/<mangled-cwd>/memory/MEMORY.md`) — both
  marker-verified, so the originally adopted `local` profile left two
  persistent instruction channels open.
- The accepted empty source list (`--setting-sources ""`) blocks
  `CLAUDE.local.md` but does NOT block auto memory.
- `--settings '{"autoMemoryEnabled":false}'` blocks the auto-memory
  channel; this is the documented disable surface, honored from the
  `--settings` flag.
- Faithful panel worker and judge argv under the combined profile
  (`--setting-sources ""` + the autoMemoryEnabled=false settings flag)
  behaved normally: Read tool, Bash allowlist, permission mode, and the
  judge no-tools JSON contract all intact.
- Headless `claude --print` creates `~/.claude/projects/` entries per
  cwd even under `--no-session-persistence` — cosmetic state litter with
  no instruction effect unless memory content exists for that cwd.

## Decision

### Claude Code (both transports, worker and judge)

Append `--setting-sources ""` (empty source list) plus
`--settings '{"autoMemoryEnabled":false}'` to the shared base argv.
Together these block the user memory layer, the project memory layer,
`CLAUDE.local.md`, and auto memory. The profile was `--setting-sources
local` when first accepted; the PR #19 review surfaced the two channels
`local` leaves open, and the follow-up probes above drove the amendment.
Losing the project layer is intended, not collateral: panel task context
flows through the rendered prompt and ContextManifest, and removing
cwd-picked instructions is the same trade ADR 0034 made for cursor's
project rules.

### OpenCode SDK/serve (default transport, worker and judge)

Set `XDG_CONFIG_HOME` to a run-scoped empty scratch directory in the
serve spawn environment. This blocks the user-config `instructions`
channel and the global rule-file channel. The project layer (cwd
`AGENTS.md`) remains injected and stays a standing disclosure — an
explicit asymmetry with claude-code that the disclosure wording records.

### OpenCode CLI (non-default transport)

No blocking profile; disclosure-only. Both redirect envs hang the CLI
outright, so there is nothing to adopt. The two reproducible hang
triggers (config redirect envs; an `instructions` key in the user
config) enter the fragility register below. A hang surfaces through the
existing worker timeout as a disclosed dropout; no new guard mechanism
is added.

### Cursor

No change. Account-level User Rules are not run-scope controllable
(ADR 0032/0034 standing disclosure) and the project layer is already
blocked by the ADR 0034 scratch-cwd profile.

### Disclosure wording

`instructionEnvironmentDisclosures` remains the single wording source
(ADR 0043). Its entries shift from "injected by default" to the blocked
state per harness/transport: claude-code notes the amended profile block
(empty `--setting-sources` list plus autoMemoryEnabled=false, covering
user/project memory, `CLAUDE.local.md`, and auto memory); opencode(sdk)
notes the config-dir redirect block plus the surviving project layer;
opencode(cli) notes that nothing is blocked — user config instructions
and global rule files arriving through user-config merge, project
`AGENTS.md` from the session cwd — and that `--pure` is verified
plugins-only.

### Fragility register and smokes

Both adopted blocks rest on probed, undocumented-or-underdocumented
behavior and join the smoke-monitored fragility list:

- claude-code: memory loading being gated by setting sources is probed
  behavior, not documented behavior.
- opencode: the redirect being honored by `serve` is probed behavior.
- opencode CLI: the two hang triggers above (monitored as known-fragile,
  not smoked — the transport has no adopted surface).

Non-invasive live smokes (gated like the existing live suite) monitor
the adopted surfaces without ever touching real user configs:

- claude-code pair: scratch cwd `CLAUDE.md` and `CLAUDE.local.md`
  markers are detected by a baseline argv without the blocking flags,
  and suppressed to NONE by the adopted argv.
- opencode pair: a marker inside a populated scratch redirect target is
  detected (redirect honored), and the adapter's empty redirect yields
  NONE (block effective).

## Rejected and deferred

- **Selective claude-code suppression that keeps the project layer**:
  impossible (project source re-enables user memory) and undesired
  (panel homogeneity argues for removing cwd instructions too).
- **Blocking the opencode project layer via a cwd change**: opencode has
  no `--add-dir` equivalent, so a scratch cwd would break the workspace
  read model. The layer stays as a disclosed residual.
- **`CLAUDE_CONFIG_DIR`-based user-layer smoke**: the variable relocates
  credentials along with config ("Not logged in"), and copying
  credentials into scratch dirs is not acceptable practice.
- **A hang-guard mechanism for the opencode CLI transport**: the worker
  timeout already converts hangs into disclosed dropouts.
- **An auto-memory smoke leg**: it would have to plant marker files
  inside the real `~/.claude/projects/` namespace (scratch-scoped
  entries, but still the live state tree); the disable flag is
  documented behavior, so the channel stays covered by the probe record
  rather than a recurring smoke.
- **Recording probe markers as a runtime detection feature**: probes are
  one-shot rounds with synthetic tokens; runtime detection of real
  injected content stays prohibited (ADR 0043).

## Consequences

- Default panels (claude-code + opencode-sdk) now run with user-level
  and global instruction layers blocked, shrinking the quality-layer
  drift ADR 0033 bounded to: cursor User Rules, the opencode project
  layer, and non-default opencode-cli workers — all disclosed.
- The planned global `~/.agents/AGENTS.md` wiring no longer reaches
  default-panel workers or judges on claude-code and opencode-sdk. On
  opencode-cli it not only reaches sessions but can hang them via the
  `instructions` key — a disclosed operational hazard for that
  transport.
- Phase-1 disclosure wording is narrowed where probes upgraded
  "unverified" to verified facts; SKILL.md bumps to 0.13.0.
