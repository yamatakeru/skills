# ADR 0005: Split Panel And Worker Contracts

## Status

Accepted

## Context

Fusion needs a portable interface for harness-neutral execution. A single
`runWorker` function can represent the atomic worker invocation, but panel
orchestration also includes worker selection, harness selection, session policy,
synthesis, and provenance.

Putting all of that into `runWorker` would make the worker contract too broad.

## Decision

Fusion separates panel orchestration from worker invocation.

- `runPanel` represents a Fusion panel run.
- `runWorker` represents one independent worker invocation.

The first contract form will be TypeScript-style types in documentation. JSON
Schema may be added later if machine validation becomes necessary.

## Consequences

The portable spec can describe orchestration without coupling it to any specific
harness.

Harness adapters can implement `runWorker` while an orchestrator coordinates
`runPanel`.

The TypeScript-first contract is easier to review and evolve during design. A
future JSON Schema must stay semantically aligned if introduced.
