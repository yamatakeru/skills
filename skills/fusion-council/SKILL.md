---
name: fusion-council
description: >-
  A lightweight, Fusion‑inspired council skill for complex research,
  architecture, design, code review and other high‑stakes or ambiguous tasks.
  It supports two deliberation styles – a **blind independent panel** and a
  **role‑based council** – both of which yield a structured synthesis
  highlighting consensus, contradictions, partial coverage, unique insights
  and blind spots.  Optimised for OpenCode, but portable to any agent
  harness supporting SKILL.md loading.  When hidden subagents are
  available, it will use them; otherwise it falls back to an internal
  council.
license: MIT
compatibility: >-
  SKILL.md‑compatible agents; optimised for OpenCode.  Uses hidden
  subagents when available; falls back to internal council otherwise.
metadata:
  version: "0.3.0"
  kind: "multi‑agent deliberation"
  modes: "blind,council,auto"
  default-mode: "blind"
  primary‑client: "opencode"
  fallback‑mode: "internal"
  optional‑subagents: "fusion-scout,fusion-architect,fusion-critic,fusion-verifier,fusion-panelist"
---

# Fusion Council: blind panel and role‑based council

Fusion Council is a skill-level deliberation protocol inspired by
OpenRouter Fusion's panel-and-synthesis workflow.  It is **not** an
OpenRouter Fusion API wrapper and does not call the OpenRouter Fusion API
directly.  The parent agent gathers independent outputs, synthesises them
into structured findings, and writes a final answer grounded in that
synthesis.

## Runtime rules

These rules are authoritative even if supplementary files are not read:

* Use Fusion Council only for ambiguous, high-stakes, open-ended, or
  explicitly requested panel/council tasks.  Answer trivial or narrow
  tasks directly.
* Default to **blind independent panel** when Fusion Council is invoked
  without an explicit mode.
* Treat **role-based council** as an OpenCode-oriented extension for
  coding/design review, not as the most literal OpenRouter Fusion mode.
* Give subagents the full user task and essential shared context.  Do not
  pre-digest the task into a preferred answer.
* Keep subagents independent: do not show one participant another
  participant's output before synthesis.
* Subagents are read-only by default.  `fusion-verifier` may run safe,
  allowed checks but must not edit files.
* Do not recursively spawn additional councils from any participant.
* The final answer must be grounded in the synthesis, not copied from one
  participant verbatim.

## Invocation options

Users may specify lightweight CLI-style options in natural language.
Treat these as preferences, not as a strict parser contract:

```text
fusion-council --mode blind --panelists 3 --record で、この設計をレビューして。
fusion-council -m council --roles scout,critic,verifier で使って。
```

Supported options:

* `--mode <blind|council|auto>`, `-m <blind|council|auto>`: deliberation
  mode.  If omitted, use `blind` unless the user's wording clearly asks
  for role-based review, verification, or implementation planning.
* `--panelists <n>`, `-p <n>`: number of blind independent panelists to
  spawn when available.  Prefer 2-4; avoid more unless the user
  explicitly accepts higher cost and latency.
* `--roles <list>`, `-r <list>`: comma-separated role-based council
  members to use, such as `scout`, `architect`, `critic`, and
  `verifier`.
* `--record`: save provenance under `.fusion-runs/` when the environment
  and permissions permit it.
* `--verify`: include verification planning or verification commands
  where safe and allowed.

## When to use

Use Fusion Council only when one or more of the following hold:

1. The question is open‑ended, ambiguous or requires judgement.
2. Incorrect answers would be costly (legal, medical, financial,
   production code, architecture decisions).
3. The problem has multiple plausible approaches or trade‑offs.
4. The user explicitly asks for a "fusion", "panel", "ensemble", or
   multi‑model answer.

For routine coding tasks, small bug fixes, or simple factual questions,
answer directly without invoking a panel.

## Mode selection

Choose the lightest tier that preserves quality:

### Tier 0 — Direct answer (no council)

If the question is narrow and well scoped (e.g. "What is the capital
of France?", "Rename this variable"), answer directly without
invoking any council.  Don't over‑deliberate trivial prompts.

### Tier 1 — Internal council (fallback)

If hidden subagents are unavailable or disabled, perform a lightweight
internal council: make two or more internal passes over the task and
synthesise them into the same five findings.  Do not recursively spawn
more councils.

### Tier 2 — Blind independent panel (default when subagents exist)

When subagents are available, use blind panel for `--mode blind`,
`--mode auto` when independent convergence is valuable, or any invocation
without a mode.  Spawn 2-4 neutral `fusion-panelist` subagents or
model-specific copies.  Give each the **same prompt**, no assigned role,
no persona, and no visibility into other panelists' outputs.

### Tier 2 (alternative) — Role‑based council

Use role-based council for `--mode council`, explicit role requests, or
coding/design tasks where division into context, design, critique and
verification is clearly more useful than same-prompt convergence.  Spawn
only the requested or useful roles:

* `fusion-scout`: repository or research context, facts, files,
  conventions and missing context.
* `fusion-architect`: design choices, tradeoffs, migration paths and
  minimal implementation strategy.
* `fusion-critic`: correctness, security, edge cases, maintainability and
  test gaps.
* `fusion-verifier`: targeted tests, lint, typecheck, build or repro
  commands when safe and allowed.

## Synthesis

Regardless of mode, structure the synthesis with these five findings:

1. **Consensus**: shared facts or recommendations.
2. **Contradictions**: mutually exclusive claims; do not smooth them away.
3. **Partial coverage**: important aspects only some participants covered.
4. **Unique insights**: valuable single-participant observations.
5. **Blind spots**: relevant questions or perspectives nobody addressed.

Attribute important points to their source.  For code or artifact tasks,
prefer executed verification over persuasive prose and state what was or
was not verified.  For research or design tasks, lead with consensus,
preserve contradictions and blind spots, and make recommendations only
when supported.

## Provenance and record keeping (optional)

If `--record` is requested and safe, save the prompt, participant outputs,
synthesis, final answer, verification evidence and degraded-mode notes
under `.fusion-runs/`.  Do not persist secrets or unnecessary private
data.  If recording is unavailable, mention that when relevant.

## Cost and latency

Invoking a panel or council increases token usage and latency.  Use the
smallest useful panel, avoid broad verification unless justified, and
answer directly when deliberation is not worth the cost.

## Supplementary details

The runtime protocol above is complete and authoritative.  The following
files are optional guidance for deeper operation and must not be required
for correctness:

* `details/blind-panel.md`
* `details/role-council.md`
* `details/synthesis.md`
* `details/provenance.md`
