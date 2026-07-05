import type { HarnessDescriptor, HarnessPreference } from "./types";

export function normalizeHarnessDescriptor(
  harness: HarnessPreference | undefined,
): HarnessDescriptor | undefined {
  if (harness?.kind === undefined || harness.invocation === undefined) {
    return undefined;
  }
  return {
    kind: harness.kind,
    invocation: harness.invocation,
    version: harness.version,
  };
}
