# ADR 0036: Preflight Is `--dry-run` on the Real Invocation

## Status

Accepted

Decided 2026-07-09 from the model-discovery deliberation round, with the
CLI grammar resolved by a recorded Fusion panel (unanimous top ranking for
`--dry-run` across three workers) and a grilled maintainer session.
Depends on ADR 0035 for the entry-kind vocabulary this surface discloses.

## Context

The round's original proposal was an entry-list validation flag
(`--validate-model <entry>`, repeatable) and a harness-grouped model
listing. Two findings reshaped it:

- Entry-list validation has a material fidelity gap. `resolveModelEntry`
  can prove a single entry resolves, but real invocations fail at the
  composition level: default-slot refill, judge-model resolution,
  transport compatibility, synthesizer conflicts, `--panelists`
  cardinality. Concrete recorded case: `--transport cli --models
  cursor:composer-2.5` passes entry validation and fails the real
  invocation, because cursor is sdk-transport-only (ADR 0032).
- The maintainer flagged mode-dependent `--json` payloads as a UI/UX
  anti-pattern. The panel judged the concern real for LLM parent agents
  (they bind one schema to one flag from `SKILL.md`) but manageable with
  explicit documentation; the `--help` precedent already tolerates
  mode-changing behavior.

Grammar constraints: the CLI is a single entrypoint whose only positional
is the task prompt; `--help` is the only early-exit mode; there is no
subcommand dispatch, and a bare subcommand word would collide with a
legitimate one-word prompt.

## Decision

### `--dry-run` is the preflight; `--validate-model` is not adopted

The parent agent composes the exact invocation it intends to run and
appends `--dry-run`. The CLI runs the existing preparation path —
composition resolution, judge resolution, transport guards, context
manifest creation — and exits before constructing the recorder and
runtime and before `runPanel`. There is no parallel validation code path:
preflight fidelity comes from running the same code the real invocation
runs.

`--validate-model` is not implemented. Dry-run strictly subsumes its
validation and a second overlapping mechanism invites which-tool
confusion. Revisitable if a mid-composition entry-check workflow proves
out; adding the flag later is non-breaking.

### Grammar and output contract

- The task prompt remains required under `--dry-run`. The "prompt is the
  single required positional" invariant stays unconditional, and the
  report can then include the rendered-prompt identity of the exact
  invocation being preflighted.
- Default output is human-readable text. With `--json`, stdout is a
  `DryRunReport` carrying a top-level `mode: "dry-run"` discriminator.
  `--json` is documented as "emit the structured report of this
  invocation instead of Markdown": the payload type follows the
  operation (`PanelResult` for panel runs, `DryRunReport` for dry runs).
  `PanelResult` itself is unchanged.
- `DryRunReport` contract sketch:

  ```ts
  interface DryRunReport {
    mode: "dry-run";
    panelRunId: string;
    transport: "sdk" | "cli";
    resolvedModels: Array<{
      slot: "parent" | "flagship" | "budget" | "refill" | "explicit";
      entry: string;
      kind: string;          // ADR 0035, disclosure-only
      harness: HarnessKind;
      resolvedModelId: string;
      fallbacks: string[];
      validatedBy: string;   // ADR 0035: "harness-list" | "pattern" | ...
    }>;
    judge?: { strategy: string; modelEntry?: string; harness?: HarnessKind };
    manifest: { renderedPromptHash: string; sharedContextHash: string };
    warnings: string[];
  }
  ```

  The type lives in `skills/fusion/lib/types.ts`, is exported through
  `protocol.ts`, and is added to the schema generation list.
- Exit code 0 iff the full composition resolves cleanly (all entries,
  judge, transport, no conflicts); 1 otherwise. A failed dry run reports
  the same diagnostic the real invocation would raise — first-error
  semantics inherited from the shared preparation path, which is the
  fidelity contract, not a limitation.
- `--record` combined with `--dry-run` warns and records nothing, and no
  provenance events are emitted: no panel ran, so `panel.started` would
  be false evidence.
- Honest side-effect disclosure: dry-run invokes no workers and no judge,
  but does shell out to `opencode models` / `cursor-agent models` for
  availability checks.

### Companion fix and deferred listing

- The model alias table's resolutions and fallback chains become visible
  in `usage()` and `SKILL.md` (previously discoverable only by reading
  `panel-composition.ts`).
- The harness-grouped model listing is deferred, and its grammar is
  deliberately not locked. Recorded candidate styles: a `--list-models`
  early-exit flag; a separate bundled entrypoint (one grammar, one output
  meaning per file); or a subcommand grammar, viable only after a
  breaking positional redesign and reconsidered when multiple non-run
  modes actually exist.

## Consequences

- `SKILL.md` 0.10.0 documents the idiom ("compose the exact command,
  append `--dry-run`"), the `--json` payload rule, the exit-code
  contract, and the shell-out disclosure.
- ADR 0014 is clarified rather than amended: dry-run is an early-exit
  mode of the canonical CLI, not a second execution path; the canonical
  panel execution path is unchanged.
- ADR 0035's `kind` / `validatedBy` reach users first through this
  surface; the panel report and compliance layers may adopt the same
  disclosure later without new contracts.
- Implementation constraint for review: the dry-run branch must reuse the
  real preparation path. A forked "validation-only" resolver would
  silently reintroduce the fidelity gap this ADR exists to close.
