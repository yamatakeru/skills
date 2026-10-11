import type { DefaultPolicies } from "./types";

// Harness-independent invocation limits (ADR 0049). Neither may be unbounded.
export const defaultWorkerTimeoutMs = 600_000;
export const defaultJudgeTimeoutMs = 300_000;

export function resolveWorkerTimeoutMs(timeoutMs: number | undefined): number {
  return timeoutMs ?? defaultWorkerTimeoutMs;
}

export function resolveJudgeTimeoutMs(timeoutMs: number | undefined): number {
  return timeoutMs ?? defaultJudgeTimeoutMs;
}

export const defaultPolicies: DefaultPolicies = {
  session: { mode: "fresh", reusePolicy: "none" },
  isolation: {
    requireIndependentInvocation: true,
    requireIsolatedContext: true,
    allowUnverifiedReuse: false,
  },
  blindness: {
    noPeerOutputs: true,
    noDraftSynthesis: true,
    noPanelConclusions: true,
  },
  worker: {
    allowRecursiveDelegation: false,
    denyPanelSpawning: true,
    denySubtaskDelegation: true,
  },
  tools: {
    mode: "read-only",
    allow: ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Bash"],
    deny: ["Write", "Edit", "MultiEdit", "Task", "NotebookEdit"],
    readOnlyBashCommands: [
      "git status",
      "git diff",
      "git log",
      "rg",
      "grep",
      "ls",
      "cat",
    ],
    headlessAskBehavior: "deny",
    parity: "same-by-default",
  },
  output: {
    format: "markdown",
    forbidChainOfThought: true,
    requiredSections: [
      "Answer",
      "Key evidence or reasoning",
      "Important caveats",
      "What I would verify next",
    ],
  },
  provenance: {
    record: true,
    redactSecrets: true,
    eventLog: true,
    requireMinimumEventsForFullCompliance: true,
    includeToolLogs: false,
    includeModelMetadata: true,
  },
};

export function mergeDefaultPolicies(
  overrides: Partial<DefaultPolicies>,
): DefaultPolicies {
  return {
    session: { ...defaultPolicies.session, ...overrides.session },
    isolation: { ...defaultPolicies.isolation, ...overrides.isolation },
    blindness: { ...defaultPolicies.blindness, ...overrides.blindness },
    worker: { ...defaultPolicies.worker, ...overrides.worker },
    tools: { ...defaultPolicies.tools, ...overrides.tools },
    output: { ...defaultPolicies.output, ...overrides.output },
    provenance: { ...defaultPolicies.provenance, ...overrides.provenance },
  };
}
