import type {
  HarnessDescriptor,
  HarnessKind,
  HarnessSelectionInput,
  HarnessSelectionPolicy,
  HarnessSelector,
  TransportMode,
  WorkerRequest,
  WorkerResult,
  WorkerRunner,
} from "./types";
import { defaultHarnessSelector } from "./worker-requests";

export interface AdapterRegistryOptions {
  transport?: TransportMode;
}

export class AdapterRegistry implements WorkerRunner, HarnessSelector {
  private readonly runners = new Map<HarnessKind, WorkerRunner>();

  constructor(private readonly options: AdapterRegistryOptions = {}) {}

  register(kind: HarnessKind, runner: WorkerRunner): this {
    this.runners.set(kind, runner);
    return this;
  }

  availableHarnesses(): HarnessKind[] {
    return [...this.runners.keys()];
  }

  selectHarness(input: HarnessSelectionInput): HarnessDescriptor {
    const policy = withRegisteredHarnesses(
      input.policy,
      this.availableHarnesses(),
    );
    const selected = defaultHarnessSelector.selectHarness({ ...input, policy });
    if (!this.runners.has(selected.kind)) {
      throw new RangeError(
        `Selected Fusion harness is not registered: ${selected.kind}`,
      );
    }
    return this.options.transport === undefined
      ? selected
      : { ...selected, transport: selected.transport ?? this.options.transport };
  }

  async runWorker(request: WorkerRequest): Promise<WorkerResult> {
    const kind = request.harness?.kind;
    if (kind === undefined) {
      throw new Error(`Worker ${request.workerId} does not specify a harness.`);
    }
    const runner = this.runners.get(kind);
    if (runner === undefined) {
      throw new Error(
        `No Fusion worker runner registered for harness: ${kind}`,
      );
    }
    return runner.runWorker(request);
  }
}

function withRegisteredHarnesses(
  policy: HarnessSelectionPolicy,
  registeredHarnesses: HarnessKind[],
): HarnessSelectionPolicy {
  if (policy.availableHarnesses !== undefined) {
    return policy;
  }
  return { ...policy, availableHarnesses: registeredHarnesses };
}
