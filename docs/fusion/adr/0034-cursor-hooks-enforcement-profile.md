# ADR 0034: Cursor Enforcement Moves to Run-Scoped Project Hooks

## Status

Accepted

Decided 2026-07-08 from the cursor probe round (cursor-agent
2026.07.01-41b2de7, Pro), run under a mandatory restore-to-pristine
constraint: both user-global files (`~/.cursor/cli-config.json`,
`~/.cursor/hooks.json`) were proven byte-identical to pre-probe snapshots
after the round. Supersedes the standing-gap consequences of ADR 0032; the
ADR 0032 transport decision (sdk-only) and config-injection mechanism are
unchanged.

## Context

ADR 0032 accepted three standing gaps because the permission grammar could
not express them: recursion denial (`Task` undeniable), a read-only shell
allowlist under `--force` (deny precedence absolute, web tools force-only),
and ADR 0029 read-root semantics (reads open by default). All three were
expected to keep cursor workers at `degraded` tier.

The probe round tested Cursor hooks as the missing enforcement layer. All
findings are live-verified:

- **Project-scoped hooks fire headless.** `<cwd>/.cursor/hooks.json` is
  loaded by `cursor-agent --print` when the process cwd is the project
  root. `--add-dir` does not load a directory's hooks, and a `hooks.json`
  placed in `CURSOR_CONFIG_DIR` is ignored. Official docs do not state CLI
  applicability either way; this is probed behavior, monitored by smokes.
- **`preToolUse` gates `Task`.** `subagentStart` never fired headless, but
  `preToolUse` fires with `tool_name: "Task"` and honoring
  `{"permission": "deny"}` blocks the spawn: the tool call completes as an
  `error` result ("Task blocked by preToolUse hook: …"), the worker
  survives and discloses. Recursion denial is enforceable.
- **`beforeShellExecution` restores the ADR 0022 allowlist under
  `--force`.** The hook receives the full command and can allow a
  read-only prefix list while denying the rest; denials return as
  structured `rejected` results carrying the hook's message, and the
  worker survives. Web tools and a shell allowlist are no longer mutually
  exclusive.
- **`beforeReadFile` reproduces ADR 0029 read-root semantics.** The hook
  receives the absolute path and can deny reads outside declared roots
  (denial surfaces as the known `error`/"blocked by a hook" variant). The
  open-by-default read gap closes.
- **`failClosed: true` holds when the hook crashes.** A nonexistent hook
  command blocked the action instead of failing open, so hook failure
  cannot silently disable policy.
- **Hooks also gate subagent-internal tool calls** (`preToolUse` fired for
  a spawned subagent's `Read`), giving defense in depth if a Task ever
  slips through.
- **`CURSOR_CONFIG_DIR` permissions replace, not merge.** A marker deny
  present only in the global config blocked reads in a non-injected
  control run and had no effect under injection; the injected deny list's
  integrity is proven. Injected runs left the global config untouched
  (hash-verified), while **non-injected runs write state back to the
  global config** (observed: model parameters drifted during a control
  run and were restored) — the adapter must always inject.
- **Rule injection:** `AGENTS.md` and `.cursor/rules/*.mdc` inject from
  the process cwd; account-level User Rules inject into headless runs
  regardless of `CURSOR_CONFIG_DIR` (verified by creating and deleting a
  marker rule). The latter is not run-scope controllable.

## Decision

### Worker profile (hooks-enforced, web-enabled)

Workers keep `--trust --force` and the run-scoped `CURSOR_CONFIG_DIR`
config with deny `["Shell(**)" removed — see below]`, and add a run-scoped
**hooks layer**: the adapter creates a scratch run directory as the
process cwd containing `.cursor/hooks.json` and the hook script, with
`failClosed: true` on every gating entry:

- `beforeShellExecution`: allow the ADR 0022 read-only command list, deny
  otherwise. The config-level `Shell(**)` deny is dropped so the allowlist
  can function; the hook is now the shell authority.
- `preToolUse`: deny `tool_name === "Task"` (recursion denial, enforced).
- `beforeReadFile`: deny paths outside the declared read roots
  (`readRoots` plus the target workspace), restoring ADR 0029
  deny-unless-declared semantics.
- Config-level denies `Write(**)`, `Delete(**)`, `Mcp(*)` remain as the
  second enforcement layer.

The target repository is exposed through `--add-dir` and the
`beforeReadFile` allowlist, not as the cwd. Disclosed trade-off: the
target repo's `AGENTS.md`/`.cursor/rules` no longer auto-inject into
cursor workers (task context flows through the rendered prompt and
ContextManifest instead); account User Rules still inject and stay a
standing compliance note on every cursor worker.

### Judge profile

Unchanged config denies (including the live-verified `Read(**)`) without
`--force`, plus the same hooks layer minus the read-roots allow (the judge
declares no read roots; hooks deny `Task` and shell stays config-denied).

### Fragility register

Hook loading by the headless CLI is undocumented, like `CURSOR_CONFIG_DIR`
itself; both stay on the smoke-monitored fragility list from ADR 0032.

## Consequences

- All three ADR 0032 standing gaps close with live evidence; the
  "expected `degraded`" stance for cursor workers is withdrawn. Combined
  with ADR 0033, healthy fresh-session cursor workers can reach tier
  `full`, and the adapter may report an observed tool policy equivalent to
  the panel default (read-only mode, bash allowlist present, web tools on)
  instead of a harness-shaped divergence.
- The ADR 0022/0018 forced choice recorded in ADR 0032 (web tools XOR
  shell allowlist) is dissolved rather than chosen.
- Standing disclosures that remain on every cursor worker: account User
  Rules injection (not run-scope controllable), undocumented surfaces
  (`CURSOR_CONFIG_DIR`, headless hooks), and display-name model echoes.
- The probe artifacts (fourteen transcripts, hook event logs, restore
  proofs) live under the probe job directory and are summarized in
  `FUSION_RUNTIME_HANDOFF.md`; the decisive behaviors are re-verifiable
  with the commands recorded there.
