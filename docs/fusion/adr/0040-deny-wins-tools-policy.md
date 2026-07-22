# ADR 0040: Apply ToolsPolicy Denials Across Enforcing Adapters

## Status

Accepted

Amends ADR 0037 and relates to ADR 0038.

## Context

`ToolsPolicy.deny` was part of the runtime contract, but enforcement differed
by adapter. OpenCode SDK tool availability was derived from `mode` and `allow`
without subtracting `deny`; Claude Code omitted `Bash` from its disallowed-tool
flag; and Cursor applied only its fixed worker or judge floor. A caller could
therefore state a denial that did not reduce the effective tool set.

Strict parity also cannot be decided from name mapping alone. The judge uses a
no-tools policy with `mode: "none"`, the panel allow list repeated in `deny`,
and `parity: "strict-same-required"`. Rejecting that policy merely because an
adapter lacks a native spelling for one entry would be a false failure: the
mode or a stronger profile floor has already denied every capability.

## Decision

Tool policy is deny-wins. Each enforcing adapter derives its mode-based tool
set from `mode`, `allow`, and `readOnlyBashCommands`, canonicalizes tool names,
then subtracts every canonical denial. A denial overrides mode defaults,
explicit allows, and scoped Bash commands. `mode: "none"` remains empty;
`mode: "full"` is reduced by its deny entries.

`bash` and `shell` are aliases, case-insensitively. Denying either removes the
whole shell capability. Any `readOnlyBashCommands` are discarded, and that
discard is emitted as a warning and compliance note rather than silently
ignored. Other established aliases, including `ls`/`list`, hyphenated web
tool names, and the edit family, are normalized by one shared module.

OpenCode SDK subtracts denied permission IDs and keeps Bash's catch-all deny
ahead of any command rules. Its effective-rule verifier probes every denied
permission ID as well as the scoped Bash commands. Claude Code emits denied
tools through `--disallowedTools` and removes overlapping entries from both
allow surfaces; it never emits a Bash allow alongside a Bash denial. Cursor
unions policy-derived config patterns with its immutable worker or judge floor.
Only grammar verified by live probes is placed in Cursor config:

- `bash`/`shell` becomes `Shell(**)`;
- `read` becomes `Read(**)`; and
- `write` and the edit family become `Write(**)`.

`Grep`, `Glob`, and `LS` are deliberately not widened to `Read(**)`, because
that would deny more capability than requested. Cursor instead passes the
canonical deny list into a run-scoped, fail-closed `preToolUse` hook. The hook
covers tool names without verified config grammar, while shell denial is also
enforced by an empty shell allowlist. Tool-event parsing remains a separate
observation surface; any tool name it cannot identify is disclosed as an
observation limitation even when the hook enforced the denial.

An unmappable or unknown deny entry is never silent. Non-strict parity records
a warning and compliance evidence. Strict parity fails before worker launch
only when the requested capability would otherwise remain effective. A
capability already denied by `mode: "none"`, an immutable adapter floor, or
another enforcement layer has no effective gap and does not fail. This gap
criterion keeps the judge no-tools policy valid.

Command-pattern deny entries such as `Bash(rm *)` remain unsupported. They are
disclosed, are not interpreted as tool-name denials, and cause strict parity to
fail only when the underlying capability would otherwise be effective.

The OpenCode headless CLI remains outside exact policy enforcement under ADR
0037. Its degraded disclosure remains in place; this decision does not claim
that its CLI arguments enforce `ToolsPolicy`.

## Consequences

All enforcing SDK and Claude headless paths now agree on the effective
capability rule without weakening Cursor or OpenCode hard floors. Default
policy behavior is unchanged because its allow and deny sets do not overlap.
Warnings and compliance notes make discarded Bash commands, unknown names,
Cursor hook-only coverage, and unsupported command patterns auditable.
