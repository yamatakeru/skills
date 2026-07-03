import type { PanelSpec } from "./types";

export function validatePanelSpec(panelSpec: PanelSpec): void {
  if (!Number.isInteger(panelSpec.workerCount) || panelSpec.workerCount < 1) {
    throw new RangeError("panelSpec.workerCount must be a positive integer.");
  }
}
