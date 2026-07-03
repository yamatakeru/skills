# ADR 0008: Allow Partial Panel Synthesis

## Status

Accepted

## Context

Workers may timeout, fail, refuse, or return invalid output. Failing the entire
panel whenever one worker fails can waste useful independent results and make
Fusion brittle in automation.

At the same time, silently synthesizing from fewer workers can overstate the
strength of the panel.

## Decision

Fusion allows partial synthesis when one or more workers fail.

Partial synthesis must disclose failed or missing workers and describe the effect
on confidence, coverage, and compliance.

## Consequences

`PanelResult.status` may be `partial` even when synthesis is produced.

The synthesis must not present partial results as a full panel consensus.

Policies such as minimum successful workers may be added by implementations, but
the portable protocol permits partial synthesis by default.
