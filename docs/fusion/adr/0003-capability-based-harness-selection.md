# ADR 0003: Select Harnesses By Capability

## Status

Accepted

## Context

Fusion may use multiple concrete harnesses to invoke workers, such as OpenCode,
pi, Claude Code, or direct API adapters. Some model families may be practically
available through only one harness in a given environment. For example, Claude
models may need Claude Code when subscription or routing constraints prevent use
through another harness.

## Decision

Fusion uses capability-based harness selection.

The portable spec does not hardcode model-to-harness routing. Instead, the
orchestrator selects a harness from:

- the requested model or model preference,
- available harness adapters,
- required capabilities,
- workspace and tool constraints,
- user or environment policy.

Claude Code, OpenCode, pi, and direct APIs are adapter candidates, not protocol
requirements.

## Consequences

The same model may be served by different harnesses in different environments.

Harness adapters must report the actual harness and model used in worker
results.

Implementation-specific policies, such as preferring Claude Code for Claude
models, belong in harness selection policy rather than the portable protocol.

## Example

```text
selectHarness({
  modelPreference,
  availableHarnesses,
  requiredCapabilities,
  userPolicy,
  workspace
}) -> HarnessPlan
```
