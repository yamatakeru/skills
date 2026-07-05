# Fusion Runtime Handoff

Date: 2026-07-05

This handoff captures the current state of the Fusion runtime work, what is not yet satisfied, and the next work needed to make the skill practically usable.

## Current Status

- Fusion now has a TypeScript reference runtime under `skills/fusion/lib/`.
- The runtime contract is library-first, not skill-first or CLI-first.
- `runPanel` can build worker requests, invoke a registered worker runner, collect worker results, run deterministic fallback synthesis, emit provenance events, and evaluate compliance.
- `AdapterRegistry` can register harness adapters and select between registered harnesses.
- Initial headless CLI adapters exist for `opencode` and `claude-code`.
- Optional run recording exists through `NoopRunRecorder` and `FileRunRecorder`.
- Runtime JSON Schemas are generated under `skills/fusion/schema/` from the TypeScript contracts.
- The existing `skills/fusion/SKILL.md` still describes the older skill behavior based on internal passes and OpenCode hidden subagents.
- The new runtime is not yet wired into `SKILL.md` as the actual skill execution path.
- There is no user-facing Fusion CLI wrapper yet.

## Implemented Files

- `package.json`: Bun scripts and dev dependencies for tests, typecheck, and schema generation.
- `tsconfig.json`: TypeScript config for Fusion runtime and tests.
- `bun.lock`: Bun dependency lockfile.
- `.gitignore`: now includes `node_modules/` and `.fusion-runs/`.
- `skills/fusion/lib/types.ts`: portable runtime contracts and recorder interfaces.
- `skills/fusion/lib/run-panel.ts`: panel orchestration, provenance events, recorder hooks, synthesis gating, compliance evaluation.
- `skills/fusion/lib/protocol.ts`: public TypeScript barrel export.
- `skills/fusion/lib/recorder.ts`: no-op and file recorders with redaction and safety checks.
- `skills/fusion/lib/deterministic-synthesizer.ts`: deterministic fallback synthesizer.
- `skills/fusion/lib/adapter-registry.ts`: harness registration, selection, and dispatch.
- `skills/fusion/lib/headless-cli-adapters.ts`: initial OpenCode and Claude Code headless CLI adapters.
- `skills/fusion/test/runtime.test.ts`: runtime tests for selection, manifests, adapters, recorder, compliance, and synthesis.
- `skills/fusion/schema/`: generated JSON Schemas for runtime contracts.

## Verified Baseline

- `bun test` passes with 22 tests.
- `bun run typecheck:fusion` passes.
- `bun run schema:fusion` passes.

## Real CLI Smoke Test Results

### OpenCode

- Real `opencode run --format json --pure` execution succeeded for a minimal prompt.
- The raw OpenCode JSON event carries final text at `part.text`.
- Current adapter parser does not read `part.text`.
- Adapter result is currently `invalid-output` even though OpenCode returned the expected answer.
- Fix needed in `skills/fusion/lib/headless-cli-adapters.ts` to parse OpenCode JSON event lines with `record.part.text`.

Observed OpenCode event shape:

```json
{"type":"text","part":{"type":"text","text":"fusion-smoke-ok"}}
```

### Claude Code

- Real `claude` CLI invocation reached argument parsing and process startup.
- Current adapter args are not correct for the local Claude Code CLI.
- `--output-format stream-json` requires `--verbose` in this environment.
- `--tools Read,Grep,Glob,LS` can consume the trailing prompt because `--tools` is variadic.
- `--tools=Read,Grep,Glob,LS` preserves the prompt argument.
- With corrected raw args, Claude Code started but failed with `401 Invalid authentication credentials` in this environment.
- Because of the 401, a successful Claude Code worker result has not yet been verified here.

Corrected raw Claude shape to test after adapter changes and auth fix:

```bash
claude --print --verbose --output-format stream-json --permission-mode dontAsk --no-session-persistence --tools=Read,Grep,Glob,LS "Return exactly: fusion-smoke-ok"
```

## Currently Not Satisfied

- The Fusion skill is not practically usable through `skills/fusion/SKILL.md` with the new runtime.
- Natural language skill invocation does not start `runPanel` or the headless harness adapters.
- There is no Fusion runtime CLI wrapper for users to call directly.
- OpenCode headless adapter does not parse real OpenCode JSON output correctly yet.
- Claude Code headless adapter does not build locally valid stream-json args yet.
- Claude Code worker success is blocked by local CLI authentication failure in this environment.
- Full compliance is not proven for either harness.
- SDK-based adapters are not implemented.
- Model selection is implemented only at the runtime contract and adapter-argument level, not exposed through a supported skill-facing interface.
- Recorder integration exists in the library, but there is no skill-facing `--record` path that creates `FileRunRecorder` automatically.
- The deterministic synthesizer is a fallback for testability, not the final quality target for production synthesis.
- The current `SKILL.md` still says the runtime protocol in the skill text is authoritative, but that text does not describe the new library runtime or harness behavior.

## Immediate Next Work

1. Fix OpenCode parser in `headless-cli-adapters.ts` to read `part.text` from JSON event lines.
2. Add a regression test using the real OpenCode event shape.
3. Fix Claude Code arg builder to include `--verbose` when using `stream-json`.
4. Fix Claude Code tools argument to use `--tools=<comma-list>` instead of separate variadic args.
5. Add a regression test for the corrected Claude Code args.
6. Re-run `bun test`, `bun run typecheck:fusion`, and `bun run schema:fusion`.
7. Re-run OpenCode real CLI smoke test through `OpenCodeHeadlessCliAdapter`.
8. Re-run Claude Code real CLI smoke test after local Claude auth is fixed or with an environment known to be authenticated.
9. Only after both adapters smoke-test correctly, start wiring the runtime into a user-facing skill or CLI entrypoint.

## Practical Usability Requirements

- A user can invoke Fusion without writing a custom Bun script.
- The invocation path can choose `opencode`, `claude-code`, or both.
- The invocation path can set panel size.
- The invocation path can set model preferences.
- The invocation path can enable recording when safe.
- The invocation path shows whether the run is full, degraded, partial, or failed.
- The skill docs match the actual execution path.
- Runtime failures are reported clearly instead of being silently downgraded.
- Real OpenCode CLI output is parsed into `WorkerResult.status: "ok"`.
- Real Claude Code CLI output is parsed into `WorkerResult.status: "ok"` in an authenticated environment.

## Future Full-Compliance Requirements

- Both OpenCode and Claude Code workers must use the same `WorkerRequest` to `WorkerResult` contract.
- Workers must receive the same rendered prompt and shared context unless an explicit policy says otherwise.
- Worker blindness must be enforced by the orchestrator.
- Worker invocations must be independently launched.
- Session isolation must be proven or explicitly downgraded.
- Tool policy enforcement must be proven or explicitly downgraded.
- Compliance must be derived by the orchestrator, not trusted from worker self-report alone.
- Required provenance events must be present for full compliance.
- `ContextManifest` must be present for full compliance.
- Recording must be optional, redacted by default, and visibly marked as not recorded, partial, complete, or failed.
- Full-compliance runs must not depend on hidden shared state from the parent assistant session.
- SDK/API transports should be preferred when they can provide stronger evidence than raw CLI execution.
- Same-agent or internal-pass behavior must remain classified as degraded/local simulation, not full compliance.

## Skill Integration Work

- Update `skills/fusion/SKILL.md` to distinguish current legacy hidden-panel behavior from the new headless runtime.
- Decide whether the skill should call a CLI wrapper or provide instructions to run a Bun entrypoint.
- Add a small runtime entrypoint if skill execution needs a stable command.
- Map `--panelists` to `PanelSpec.workerCount`.
- Map `--models` to `PanelSpec.modelPreferences` and harness selection policy.
- Map `--record` to `FileRunRecorder` with `.fusion-runs/` safety checks.
- Map `--verify` to prompt/output-contract guidance without granting write tools by default.
- Document supported model syntax for OpenCode and Claude Code separately.
- Preserve existing blind-panel rules: same prompt, no roles, no peer outputs, no private chain-of-thought.

## Suggested Runtime CLI Shape

This is not implemented yet. It is a suggested shape for the next implementation step.

```bash
bun run fusion:run --panelists 2 --harnesses opencode,claude-code --models openai/gpt-5.5,sonnet --record "Review this design"
```

Suggested behavior:

- Build a `PanelRequest` from command-line options.
- Register `OpenCodeHeadlessCliAdapter` when `opencode` is requested.
- Register `ClaudeCodeHeadlessCliAdapter` when `claude-code` is requested.
- Use `AdapterRegistry` as both `runner` and `harnessSelector`.
- Use `FileRunRecorder` only when `--record` is supplied.
- Use `DeterministicSynthesizer` until a harness-backed synthesizer exists.
- Print final synthesis, status, compliance tier, warnings, and recording status.

## Useful Commands

```bash
bun test
bun run typecheck:fusion
bun run schema:fusion
opencode run --format json --pure "Return exactly: fusion-smoke-ok"
claude --print --verbose --output-format stream-json --permission-mode dontAsk --no-session-persistence --tools=Read,Grep,Glob,LS "Return exactly: fusion-smoke-ok"
```

## Important Caution

- Do not claim the skill is usable through `SKILL.md` until the runtime is wired into the skill-facing path.
- Do not claim Claude Code harness success until authentication is fixed and a real adapter smoke test returns `status: "ok"`.
- Do not claim full compliance until session isolation, tool policy, provenance, and context-manifest requirements are verified from orchestrator-controlled evidence.
