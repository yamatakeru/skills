---
name: fusion
description: >-
  Runs a blind panel of different models on the same task, then returns a
  judge's comparison (consensus, contradictions, gaps) for the calling agent to
  synthesize. Use when independent second opinions are likely to change or
  sharpen a conclusion: open research questions, architecture or design
  choices, critique of a plan or spec, or a multi-model second-opinion review.
  Trigger on "fusion", "blind panel", "second opinion", "ask other models",
  "セカンドオピニオン", "複数モデルで". Not for narrow lookups or routine
  single-pass code review.
license: MIT
compatibility: >-
  SKILL.md-compatible agents with shell access and Bun installed. The bundled
  TypeScript CLI needs no node_modules. OpenCode workers need stable OpenCode
  2.0.22+, 2.1.x, or 2.2.x.
metadata:
  version: "0.15.0"
  kind: "blind-panel synthesis"
  mode: "blind"
  canonical-runtime: "bun-cli"
---

# Fusion

Fusion asks several models the same question independently, has a separate
judge compare their answers, and leaves the final answer to you, the calling
agent. It is inspired by OpenRouter Fusion's panel-and-synthesis workflow but
does not call the OpenRouter API.

Match the panel to the stakes: the default mixed panel suits hard-to-reverse
decisions, and cheaper `--models` lists are fine for exploratory work. Answer
trivial or narrow tasks directly instead.

## Run the panel

```bash
bun <skill-dir>/bin/fusion-run.ts --parent-model <your model id> \
  --context "<brief>" "task"
```

- `<skill-dir>` is this skill's directory. Bun is required; if `bun` is
  missing, tell the user to install it from https://bun.sh/docs/installation
  instead of improvising another path.
- Pass your own model as `--parent-model` whenever it is a supported entry. It
  fills the default panel's parent seat and selects the judge model; it does
  not change who writes the final answer. If your model is not expressible,
  omit it and accept the CLI's warning.
- Workers see only the task and shared context, not this conversation. Put
  the background they need in `--context` (a brief you write) and
  `--context-file` (repeatable, embeds a file). Use `--read-root <dir>` when
  workers must read outside the workspace.
- Write the task and context neutrally. Every worker gets the same prompt;
  adding roles, personas, debate positions, or a preferred answer breaks the
  blind panel.
- `--models a,b,c` replaces the default panel. `--judge-model` changes the
  judge. `--effort` raises worker reasoning for high-stakes tasks. Append
  `--dry-run` to the exact command to see which models resolve. `--help`
  lists every option and the model alias table.

## Read the report and answer

The report lists each worker's output, then a judge analysis with five
findings: consensus, contradictions, partial coverage, unique insights, and
blind spots. The judge compares; it does not pick a winner or write the answer.

Verify load-bearing claims with your own tools where it matters, then write the
final answer yourself from the judge analysis and the worker outputs. Lead with
well-supported consensus, keep real contradictions visible, and name blind
spots that limit confidence.

If the run status is `failed` (no worker succeeded), report the failure and
its reasons and offer a retry; do not answer as if a panel had run. Otherwise,
if the judge failed or did not run, the report says so. Synthesize from the
deterministic audit synthesis when the report includes one, otherwise
directly from the worker outputs. If the run status is
`partial`, say which workers are missing and do not present the result as
full-panel consensus.

## Gotchas

- **A run can take about 15 minutes** (workers up to 10, judge up to 5). Start
  it so your own tool-call time limit cannot kill it first, for example as a
  background job you wait on, even for small tasks; an interrupted run loses
  the report. For long investigations raise `--worker-timeout-ms` rather than
  stopping the run yourself.
- **Exit code 0 does not mean every worker succeeded.** `partial` also exits 0.
  Read the run status and each worker's status.
- **Dry-run is not a live check.** It resolves models without starting the
  OpenCode server or calling providers, so expired provider credentials (for
  example `Request failed: 401`) and an unsupported OpenCode version appear
  only as worker errors in a real run.
- **`--models` drops the parent seat**, but the judge still follows
  `--parent-model`. Set `--judge-model` when you want a different judge.
- **Claude aliases float.** `fable`, `opus`, `sonnet`, and `haiku` resolve to the
  latest model of that tier; pass a full `claude-*` ID to pin one.
- **Workers get read-only tools, not a sandbox.** Edit tools, non-allowlisted
  commands, and delegation are denied, so ask for patches or plans, not
  changes. The shell allowlist can still be abused (for example `ls > f`).
  The Workspace watchdog compares Git status and refs before and after the
  run, so it is not exhaustive: further edits to files already dirty before the
  run can stay `clean`, it is `not-applicable` outside a Git work tree, and it
  cannot see gitignored areas, writes outside the workspace, or remote side
  effects. Use an OS-level sandbox when a task needs real isolation.
- **Denied reads do not crash a worker, and its answer may not mention
  them.** When a source matters, check the worker's Warnings in the report and
  `toolUseSummary.deniedRequests` in `--json` output before trusting coverage.
- **Project `AGENTS.md` still reaches OpenCode workers.** The report's
  Instruction environment line says which instruction layers were blocked.
- **Recover a crashed run's synthesis** with
  `<skill-dir>/bin/fusion-judge-replay.ts` when the run was started with
  `--record`; see
  `details/provenance.md`.

## When the CLI cannot run

Only if the CLI cannot run at all (no Bun after telling the user, or no usable
harness), you may simulate the panel yourself: announce the degraded status
first, keep the same prompt in separate passes, produce the same five
findings, and state that this is not a full-compliance Fusion panel. Do not
substitute any other execution path silently.

## Further reading

Read these only when the situation calls for it:

- `details/runtime.md`: how model entries route, how the default panel is
  composed and refilled, judge selection, the full option semantics, exit
  codes, and per-harness instruction blocking. Read it when a resolution,
  warning, or harness behavior in the report is unclear.
- `details/containment.md`: threat model, residual holes, and evidence layers
  behind the report's Containment and Enforcement lines. Read it before relying
  on containment for a sensitive task.
- `details/provenance.md`: `--record` artifacts, crash markers, and judge
  replay.
- `details/blind-panel.md` and `details/synthesis.md`: background on panel
  design and synthesis.
