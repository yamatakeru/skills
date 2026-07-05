import type { DefaultPolicies } from "./types";

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
    allow: ["Read", "Grep", "Glob", "LS", "WebSearch", "WebFetch", "Bash"],
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
