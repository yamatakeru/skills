# ADR 0054: Admit the OpenCode 2.4 Release Line

## Status

Accepted. Partially supersedes ADR 0053's supported boundary ("stable 2.0.x
from 2.0.22, or any stable 2.1.x, 2.2.x or 2.3.x") and its 2.3.0 type-only
pin. ADR 0050's reasoning for admitting a whole minor line, and every ADR
0046/0048 decision, remain unchanged.
The acceptance of the case-insensitive read-root residual is superseded by
[ADR 0055](0055-opencode-read-root-case-fail-closed.md), which fails such
read roots closed.

## Context

The installed OpenCode was upgraded to v2.4.0. Fusion's version gate only
matched `^2\.([0-3])\.(\d+)$`, so a real panel rejected every OpenCode worker
with `Unsupported OpenCode version 2.4.0` before sessions were created, and
the free contract check skipped itself as unsupported. As with ADR 0053,
dry-run did not reveal this.

## Evidence (2026-11-23)

- The no-model contract check
  (`skills/fusion/test/opencode-containment.integration.test.ts`), run against
  the real `opencode v2.4.0` binary with only the gate relaxed, passed:
  authentication, `/api/info` identity, native effective rules, parked prompt
  admission, interrupt and owned process shutdown.
- Upstream `packages/core/src/permission.ts` changed between tags `v2.3.2`
  ([`c0ad18b4`](https://github.com/anomalyco/opencode/tree/c0ad18b402eb2827fc1ee71c171b1177b3fc02d1))
  and `v2.4.0`
  ([`44aed4fd`](https://github.com/anomalyco/opencode/tree/44aed4fd144611879046ae923c25541f913780ad)).
  `evaluate` keeps the last-match evaluation that ADR 0048 depends on
  (`rulesets.flat().findLast(...)`). The only change (upstream `79bd2c6f`,
  "match file permission rules without case on macOS") is that on macOS the
  resource match ignores case for the path actions `external_directory`,
  `read` and `edit`, because default macOS volumes resolve
  case-insensitively. It applies equally to allow and deny rules. On a
  default volume a deny can no longer be bypassed by a case variant of a
  path, and allows still match only the same files. On a case-sensitive
  volume, however, Fusion's read-root allows (`external_directory` for
  `<root>` and `<root>/**`) also match every path that differs from the root
  only in letter case, in any component, and those are different
  directories: a `/Volumes/Work/repo` root admits `/Volumes/WORK/repo/...`
  and `/Volumes/Work/REPO/...`. A trailing deny cannot carve a variant out,
  because it would match the declared root with the same case folding.
- The `@opencode/client` 2.3.0 to 2.4.0 type diff does not touch the
  endpoints, events or types Fusion reads (`/api/info`, `/api/agent`,
  `/api/event`, `/api/session` prompt/interrupt/permission reply,
  `AgentInfo`, `PermissionRule`, and the session/permission events the
  collector consumes). It adds an `experimental.job.updated` event, which the
  collector ignores, and renames the Schedule types to Automation and adds
  video generation types, none of which Fusion uses.
  `bun run typecheck:fusion` passes with `@opencode/client` pinned at 2.4.0.
- The runbook's default-panel live smoke on 2.4.0 (`--parent-model fable`)
  returned run status ok with full compliance and no warnings: both OpenCode
  workers (`openai/gpt-6.2-sol`, `opencode-go/qwen3.8-flash`) succeeded on
  harness version 2.4.0 with `verified-effective` enforcement and successful
  aborts, only the already-tolerated appended denies (`browser:*`,
  `skill:browser`, ADR 0048) followed Fusion's rules, and the Claude Code
  worker and judge (`claude-fable-5-2`) succeeded.

## Decision

The supported OpenCode boundary is stable **2.0.x from 2.0.22, or any stable
2.1.x, 2.2.x, 2.3.x or 2.4.x**. The measured target is **2.4.0**. The
type-only `@opencode/client` pin moves to 2.4.0. Prereleases, 2.5+ and other
release lines still fail explicitly before session creation. A further minor
line needs the same check and a new decision; it is not admitted
automatically.

The case-insensitive read-root match on case-sensitive macOS volumes is
accepted as a documented residual, not mitigated in the adapter. It needs a
non-default case-sensitive volume and a path differing only in case from a
declared read root, Fusion's containment is a harness allowlist rather than
an OS sandbox, and the same upstream change closes the opposite case-variant
bypass of denies on default volumes. The limitation is stated in
`details/containment.md`, which `SKILL.md` already routes callers to before
relying on containment for a sensitive task. It is not a `SKILL.md` Gotcha:
it was not observed in a real run, and the body carries no version ranges
(ADR 0052).

## Considered Options

- **Keep 2.0 to 2.3 only**: stops every OpenCode worker on the installed
  binary; downgrading OpenCode is outside Fusion's scope.
- **Admit 2.4.x alongside the existing lines** (chosen), for the reasons ADR
  0050 gives for admitting whole minor lines.
- **Drop older lines while admitting 2.4**: no evidence that they regressed,
  and dropping them would add a forced upgrade for no safety gain.
- **Fail closed for read roots on case-sensitive volumes** (detect volume
  case sensitivity on darwin with 2.4+ and refuse the OpenCode worker):
  closes the residual, but adds detection logic, tests and review for a
  non-default setup. Deferred as a possible follow-up rather than blocking
  the release-line admission.
- **Keep 2.4 out until mitigated**: leaves the default panel two seats short
  on the installed binary for a narrow, documentable residual.

## Consequences

The ADR 0053 procedure is unchanged: after each OpenCode upgrade, run the
free contract check in the runbook, and re-read `Permission.evaluate` and
`evaluateInput` when `permission.ts` changes upstream. The boundary remains
defined once, in `isSupportedOpenCodeVersion`.
