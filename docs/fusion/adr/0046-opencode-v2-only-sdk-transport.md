# ADR 0046: OpenCode v2-only SDK Transport

## Status

Accepted. Supersedes the OpenCode v1 protocol and retained OpenCode CLI option in
ADR 0028, the OpenCode implementation mechanisms in ADR 0029/0037, and the
OpenCode-specific startup profile/disclosures in ADR 0045. Portable permission,
isolation, cleanup, and evidence requirements remain unchanged; other harnesses
are unchanged. Tracking: [issue #21](https://github.com/yamatakeru/skills/issues/21).

## Decision

On 2026-09-21 the owner confirmed that OpenCode v1 is no longer installed and
Fusion is primarily for personal use. Maintain one OpenCode adapter for the
v2 machine protocol, not parallel v1/v2 implementations. Remove the degraded
OpenCode CLI adapter; selecting OpenCode under `--transport cli` is an explicit
usage error, never a fallback. Claude Code's CLI transport remains available.

The target is OpenCode **2.0.12**, upstream commit
[`2670273ff17da96f85c5826ced57aa1b368754fa`](https://github.com/anomalyco/opencode/tree/2670273ff17da96f85c5826ced57aa1b368754fa).
The adapter accepts stable 2.0.x patches from 2.0.12, inspects the actual server
identity and effective rules, and rejects unknown release lines. The sole
OpenCode package dependency is pinned `@opencode/client` for **type-only**
imports. The skill still runs without npm runtime dependencies; the embedded
`@opencode/sdk` is not adopted.

Use one owned, authenticated `serve --stdio` process per run, never a shared
service for worker/judge execution. `--stdio` removes the server password from
the environment inherited by tools and ties server lifetime to its parent's
stdin. All REST and SSE requests authenticate; redirects and secret-bearing
HTTP error bodies are not accepted as diagnostic evidence. Readiness uses
`/api/info`, not a success interpretation of 401/404. Retain ADR 0028's single
fresh-port startup retry for an early process exit or readiness timeout, after
reaping the failed child; authentication, unsupported-version, and invalid
identity errors fail immediately without retry. Each attempt has a 30-second
readiness window. An explicitly injected server requires its own password and
identity, is never killed, and cannot claim Fusion-controlled startup
instruction isolation.

Emit native ordered `agents.<name>.permissions` rules. Verify the exact ordered
suffix beginning with Fusion's catch-all deny before prompting, including
read roots and the no-tools judge. Earlier inherited rules are shadowed by
that reset. This replaces the former sampled permission probes. Missing
agents during asynchronous location initialization are awaited, not bypassed.
Rules are reinspected for each invocation. There is no deprecated `tools`
map, v1 prompt fallback, or `continue_loop_on_deny` dependency.

Subscribe through the `server.connected` handshake before admitting a prompt.
Input admission and individual tool/assistant steps are not completion;
`session.execution.succeeded` is the success boundary. Assemble final text
from the last completed assistant step, not private reasoning. Retain tool,
model, usage and denial evidence. Stream corruption/disconnection, failed or
interrupted execution fail visibly; live SSE is not replayable. Every terminal
session path requests interrupt before disconnecting the event stream;
`interrupted:false` is the valid idle no-op. Owned process disposal remains the
backstop for cleanup failures.

Redirect both `OPENCODE_CONFIG_DIR` and `XDG_CONFIG_HOME` to a fresh empty
run directory, unset `OPENCODE_CONFIG`, and inject only the run profile.
Project/ancestor `AGENTS.md` discovery remains and is disclosed. No user
instruction contents or credentials are copied into fixtures or runtime
provenance. Do not claim that the older v1 `--pure` findings prove v2 behavior.

### Web search consent

The v2.0.12 smoke exposed a new provider-selection form: permission-allowed
`websearch` with no selection waited roughly one minute and returned
`Web search cancelled`. This was not a policy denial. The source
[`tool/plugin/websearch.ts`](https://github.com/anomalyco/opencode/blob/2670273ff17da96f85c5826ced57aa1b368754fa/packages/core/src/tool/plugin/websearch.ts)
confirms this first-use form and its one-minute timeout.

The owner explicitly chose **Exa** for Fusion's run-scoped
`websearch: { provider: "exa" }`. Do not answer the consent form automatically,
persist a user-global selection, or randomly rotate query destinations.
A provider outage remains a disclosed tool failure rather than an implicit
switch to another provider. This choice does not add tools to the judge.

## Evidence and limitations

The 2026-09-21 no-model probe on 2.0.12 observed authenticated info, 401 without
credentials, initially empty then populated agents, native permission effects,
`resume:false` prompt admission with no active execution, and idle interrupt.
The contract integration test covers these boundaries without model calls.

A scratch live worker observed successful workspace/read-root reads, a
structured rejection for an undeclared external path, continued to a final
answer, and executed the allowed `ls`. A synthetic project AGENTS marker
remained visible. The populated-global-redirect positive control and adapter
empty-redirect negative control both passed without touching user files.
A recorded worker/judge run exercised glob, grep, read, webfetch and valid
judge JSON; its pre-selection websearch failure motivated the consent above.
After explicit Exa selection, websearch succeeded and returned the IANA
example-domains source. A deliberately injected `read: ask` session permission
was rejected with feedback; the worker returned `DENIAL_OBSERVED`, recorded one
denial, and completed without reading the blocked content.

The bounded 2026-09-21–22 live validation used **10 sessions total**, all on
`opencode-go/deepseek-v4.1-flash` (including the separate judge and intentional
timeout). The final two-worker run
`fusion-06118641-fdef-4339-b672-1b3546ba95a5` used deterministic synthesis to
avoid another judge call. Both invocations started at `16:29:15.715Z`, received
identical rendered prompts in distinct fresh sessions, read the same fixture,
and completed `ok` at `16:29:20.350Z` and `16:29:21.602Z`. The report recorded
`full`, `verified-effective`, `allowlist-enforced`, a clean workspace watchdog,
successful interrupts, and all nine base artifacts with `run-status: complete`.

The last live session admitted a long-output prompt and intentionally timed out
after 5 seconds. Immediately before interrupt its id was present in
`/api/session/active`; interrupt returned `interrupted:true`; immediately after,
the active set was empty. The adapter reported `timeout`, successful cleanup,
and the owned server became unreachable after disposal. This verifies remote
stopping rather than merely stopping local observation. Failure/stream-loss
paths are additionally covered by fixtures, without more model calls.

A one-worker transport smoke is deliberately not evidence of full-panel
compliance. The two-worker result above does not claim model diversity or a
new cross-harness/quality benchmark. The shell allowlist is still not an OS
sandbox (ADR 0039).

`opencode models` remains the catalog/preflight surface. On v2 it may start a
shared background service, even during dry-run. A cold service/location was
observed to return an empty successful catalog until provider registration
finished, so only that case gets bounded retries. This service is not owned
by Fusion and is not stopped by worker cleanup.
