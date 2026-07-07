# ADR 0032: Cursor Adapter Uses SDK Transport and a Web-Enabled Enforcement Profile

## Status

Accepted

Decided 2026-07-07 from the ADR 0030 phase-1 live capability probe against
`cursor-agent` 2026.07.01-41b2de7 (account tier Pro; the probe began on Free
and hit its usage limit mid-run, which is itself a recorded finding).
Applies the ADR 0028 transport axis to the cursor harness. Records
deliberate, disclosed divergences from ADR 0022 (read-only bash allowlist)
and ADR 0029 (read-root semantics) on this harness.

## Context

All findings below are live-probed unless marked documented; probe artifacts
are session-local, and the decisive behaviors are re-verifiable with the
commands noted in the handoff.

### Protocol surface

- `cursor-agent --print --output-format stream-json` emits a Claude
  Code-shaped protocol: `system/init` (session_id, resolved model as a
  *display name*, permissionMode, cwd), `user`, `assistant`, `tool_call`
  `started`/`completed` with full arguments, and a terminal `result`
  (is_error, result text, duration, request_id, `usage` token counts; no
  cost field). Tool results carry structured variants: `success`,
  `rejected` (mode/approval rejection), `permissionDenied` (permissions
  config block), `writePermissionDenied`.
- Undocumented `thinking`, `connection`, and `retry` events appear in the
  stream; official docs lag the implementation and declare additive
  compatibility only.
- Quota exhaustion emits a non-JSON `ActionRequiredError` line mid-stream
  and exits 1; the parser must tolerate non-JSON lines and classify this as
  a disclosed worker failure.
- `--mode` is not reflected in `init.permissionMode` (stays `default`).

### Permission model

- Documented grammar: `Shell(commandBase)`, `Read(pathOrGlob)`,
  `Write(pathOrGlob)`, `WebFetch(domain)`, `Mcp(server:tool)` in
  `permissions.allow` / `permissions.deny`; deny precedence is absolute —
  verified: a specific allow (`Shell(git status)`) cannot pierce a broad
  deny (`Shell(**)`).
- Headless default (no `--force`): non-allowlisted shell is auto-rejected
  as a structured `rejected` result without hanging; allow entries pierce
  the auto-reject for shell; the worker loop continues and the model
  discloses the denial in its final answer (the ADR 0029 target semantics).
- Web tools (`WebSearch`, `WebFetch`) are auto-rejected headless regardless
  of allow entries; only `--force` enables them. `--force` flips the whole
  policy to allow-unless-denied, so a shell allowlist and web tools are
  mutually exclusive under the current permission model.
- `--mode ask` / `--mode plan` hard-reject shell but do **not** hard-block
  edits: a forced `editToolCall` in ask mode wrote a real file. Read-only
  modes are not an enforcement mechanism; explicit deny globs are.
  `Write(**)` deny blocks edits (verified; `Delete(**)` needed separately
  for the Delete tool), including under `--add-dir`-granted roots.
- `Task` (subagent spawning) works headless and is not deniable by any
  probed token (`Task`, `Task(*)`, `Task(**)`): recursion denial is not
  enforceable. `Mcp(*)` deny blocks MCP tool calls at invocation; approved
  user-global MCP servers do load headless, unapproved ones do not.
- Reads are open by default: no workspace jail, `$HOME` files readable
  without `--add-dir`. Because deny is absolute, a deny-by-default-with-
  exceptions read policy cannot be expressed.
- `CURSOR_CONFIG_DIR` (undocumented) redirects `cli-config.json` to a
  run-scoped directory without breaking login auth, enabling per-run config
  injection that leaves the user's global config untouched. Whether the
  injected config fully replaces or merges with the user's global config is
  unresolved; treated as the analog of OpenCode's global-config merge note.
- Workspace trust is required headless: untrusted directories fail fast
  with a clear error unless `--trust` is passed.
- Operational: `cursor-agent models` enumerates account models
  (`id - label` lines); three parallel spawns completed cleanly; a cheap
  model (`composer-2.5-fast`) once hallucinated a `<user_query>`
  continuation after completing its answer (worker-quality note, not a
  harness defect).

## Decision

### Transport

The cursor adapter is **SDK-transport only**: it spawns
`cursor-agent --print --output-format stream-json` and consumes the full
structured protocol, which satisfies ADR 0028's protocol-surface definition
of `"sdk"` (the axis "is defined by the protocol surface and the evidence it
yields, not by process boundaries"). No cursor CLI-transport adapter is
built — there is no legacy to preserve — and selecting a cursor entry under
`--transport cli` is a disclosed selection error, consistent with ADR 0028's
no-silent-fallback rule.

### Worker enforcement profile (web-enabled)

Workers run with `--trust --force` plus a `CURSOR_CONFIG_DIR`-injected
`cli-config.json` whose deny list is
`["Shell(**)", "Write(**)", "Delete(**)", "Mcp(*)"]`:

- Web search and web fetch are enabled, matching ADR 0018 and upstream
  OpenRouter Fusion's panelist capability.
- Shell is fully denied. The ADR 0022 read-only bash allowlist cannot
  coexist with web tools on this harness (deny precedence is absolute), and
  upstream fidelity wins the forced choice: ADR 0018 mirrors upstream while
  the bash allowlist is a local extension. The missing allowlist is a
  standing warning and compliance evidence note on every cursor worker.
  The rejected alternative — no `--force`: shell allowlist works, web tools
  unavailable — is recorded and may return later as an explicit opt-in.
- Native read-only tools (Read, Grep, Glob) remain available in both
  profiles, so project-local evidence gathering survives; the loss is git
  history inspection via shell.

### Judge profile (no-tools)

The judge runs without `--force` (web tools therefore auto-reject) and with
deny `["Shell(**)", "Write(**)", "Delete(**)", "Mcp(*)", "Read(**)"]`.
`Read(**)` deny is untested and must be verified in phase 2; if reads prove
undeniable, the judge's tool-freedom is partially unenforceable on cursor
and is disclosed as evidence, consistent with ADR 0026's provisional
no-tools stance.

### Recursion denial

Unenforceable for `Task`. The portable worker instructions' delegation
prohibition remains the only control, and every cursor worker carries a
standing compliance evidence gap for recursive delegation. Intercepting
`Task` via `~/.cursor/hooks.json` is a recorded follow-up candidate; if it
lands, this gap closes.

### Read roots

ADR 0029's deny-unless-declared semantics cannot be reproduced: reads are
open by default. On cursor, `readRoots` only inform `--add-dir` (whose
write grant is neutralized by the `Write(**)` deny), and the open-read
behavior is a standing disclosure in compliance evidence rather than a
per-path policy.

## Consequences

- Cursor workers are expected to land at `degraded` tier initially: the
  recursion-denial gap and open-by-default reads prevent two full-capable
  criteria from being evidenced. This is within ADR 0030's
  target-not-gate stance; reaching `full` requires at least the hooks
  follow-up and the read-deny verification.
- The adapter depends on one undocumented surface (`CURSOR_CONFIG_DIR`) and
  one absolute-precedence permission model; both are recorded fragilities
  monitored by smoke runs, like OpenCode's deprecated
  `continue_loop_on_deny` dependency (ADR 0029).
- Panel tool parity (ADR 0006) across mixed-harness panels is knowingly
  looser: cursor workers lack shell while opencode/claude-code workers have
  the bash allowlist; the difference is recorded per worker in provenance
  and compliance notes.
- The stream parser must tolerate non-JSON lines, display-name model
  echoes (requested id recorded alongside observed display name), and the
  undocumented event types.
