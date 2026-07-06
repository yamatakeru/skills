import type { PanelSpec } from "./types";

// Every worker is a live model session; the cap bounds accidental
// resource exhaustion from oversized --panelists or --models values.
export const MAX_PANEL_WORKERS = 20;

export function validatePanelSpec(panelSpec: PanelSpec): void {
  if (!Number.isInteger(panelSpec.workerCount) || panelSpec.workerCount < 1) {
    throw new RangeError("panelSpec.workerCount must be a positive integer.");
  }
  if (panelSpec.workerCount > MAX_PANEL_WORKERS) {
    throw new RangeError(
      `panelSpec.workerCount must be at most ${MAX_PANEL_WORKERS}.`,
    );
  }
}
