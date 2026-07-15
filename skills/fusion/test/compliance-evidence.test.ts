import { describe, expect, test } from "bun:test";
import {
  buildWorkerRequests,
  deriveContainment,
  DeterministicSynthesizer,
  evaluateCompliance,
  runPanel,
  type WorkspaceWatchdogEvidence,
} from "../lib/protocol";
import {
  okRunner,
  okWorkerResult,
  panelRequest,
} from "./fixtures";

const mutatedWatchdog: WorkspaceWatchdogEvidence = {
  verdict: "mutated",
  workspaceRoot: "/workspace",
  changedPaths: ["tracked.txt"],
  refDiffs: [
    {
      refName: "refs/heads/main",
      before: "1111111111111111111111111111111111111111",
      after: "2222222222222222222222222222222222222222",
    },
  ],
  note: "workspace mutated during the run; attribution unknown — worker or external process",
  limitations: [
    "gitignored areas are not detectable",
    "writes outside the workspace are not detectable",
    "remote API side effects are not detectable",
  ],
};

describe("runtime compliance evidence", () => {
  test("accepts harness-declared enforcement as full evidence", async () => {
    const result = await runPanel(panelRequest(), {
      runner: okRunner(),
      synthesizer: new DeterministicSynthesizer(),
    });

    expect(result.complianceSummary.tier).toBe("full");
    expect(
      result.complianceSummary.workerCompliance[0]?.compliance
        .enforcementSource,
    ).toBe("harness-declared");
  });

  test("does not treat permission denials as violations", async () => {
    const result = await runPanel(panelRequest(), {
      runner: {
        async runWorker(request) {
          const worker = okWorkerResult(request);
          worker.complianceEvidence!.enforcement!.permissionDenialCount = 2;
          return worker;
        },
      },
      synthesizer: new DeterministicSynthesizer(),
    });

    expect(result.complianceSummary.tier).toBe("full");
  });

  test("caps a watchdog mutation at degraded without corroboration", async () => {
    const request = panelRequest();
    const workerRequests = buildWorkerRequests(request);
    const result = await runPanel(request, {
      runner: okRunner(),
      synthesizer: new DeterministicSynthesizer(),
      workerRequests,
    });

    const summary = evaluateCompliance({
      panelRequest: request,
      workerRequests,
      workerResults: result.workerResults,
      events: result.events ?? [],
      workspaceWatchdog: mutatedWatchdog,
    });

    expect(summary.tier).toBe("degraded");
    expect(summary.notes).toContain(mutatedWatchdog.note);
  });

  test("marks a corroborated watchdog mutation non-compliant", async () => {
    const request = panelRequest();
    const workerRequests = buildWorkerRequests(request);
    const baseline = await runPanel(request, {
      runner: okRunner(),
      synthesizer: new DeterministicSynthesizer(),
      workerRequests,
    });
    baseline.workerResults[0]!.complianceEvidence!.enforcement!.toolEvents = [
      {
        tool: "bash",
        command: "git commit -m unexpected",
        outcome: "succeeded",
      },
    ];

    const summary = evaluateCompliance({
      panelRequest: request,
      workerRequests,
      workerResults: baseline.workerResults,
      events: baseline.events ?? [],
      workspaceWatchdog: mutatedWatchdog,
    });

    expect(summary.tier).toBe("non-compliant");
    expect(summary.workerCompliance[0]?.compliance.degradedReason).toContain(
      "corroborates the observed workspace mutation",
    );
  });

  test("keeps unrelated successful mutation commands degraded", async () => {
    const request = panelRequest();
    const workerRequests = buildWorkerRequests(request);
    const baseline = await runPanel(request, {
      runner: okRunner(),
      synthesizer: new DeterministicSynthesizer(),
      workerRequests,
    });
    baseline.workerResults[0]!.complianceEvidence!.enforcement!.toolEvents = [
      {
        tool: "bash",
        command: "rm /tmp/other",
        outcome: "succeeded",
      },
    ];

    const summary = evaluateCompliance({
      panelRequest: request,
      workerRequests,
      workerResults: baseline.workerResults,
      events: baseline.events ?? [],
      workspaceWatchdog: mutatedWatchdog,
    });

    expect(summary.tier).toBe("degraded");
    expect(summary.workerCompliance[0]?.compliance.tier).not.toBe(
      "non-compliant",
    );
  });

  test("does not corroborate a changed path from an unrelated redirect", async () => {
    const request = panelRequest();
    const workerRequests = buildWorkerRequests(request);
    const baseline = await runPanel(request, {
      runner: okRunner(),
      synthesizer: new DeterministicSynthesizer(),
      workerRequests,
    });
    baseline.workerResults[0]!.complianceEvidence!.enforcement!.toolEvents = [
      {
        tool: "bash",
        command: "echo hi > /tmp/unrelated.txt",
        outcome: "succeeded",
      },
    ];

    const summary = evaluateCompliance({
      panelRequest: request,
      workerRequests,
      workerResults: baseline.workerResults,
      events: baseline.events ?? [],
      workspaceWatchdog: mutatedWatchdog,
    });

    expect(summary.tier).toBe("degraded");
  });

  test("corroborates a redirect that names the changed path basename", async () => {
    const request = panelRequest();
    const workerRequests = buildWorkerRequests(request);
    const baseline = await runPanel(request, {
      runner: okRunner(),
      synthesizer: new DeterministicSynthesizer(),
      workerRequests,
    });
    baseline.workerResults[0]!.complianceEvidence!.enforcement!.toolEvents = [
      {
        tool: "bash",
        command: "echo hi > /tmp/tracked.txt",
        outcome: "succeeded",
      },
    ];

    const summary = evaluateCompliance({
      panelRequest: request,
      workerRequests,
      workerResults: baseline.workerResults,
      events: baseline.events ?? [],
      workspaceWatchdog: mutatedWatchdog,
    });

    expect(summary.tier).toBe("non-compliant");
  });

  test("does not grant full compliance when enforcement is missing", async () => {
    const result = await runPanel(panelRequest(), {
      runner: {
        async runWorker(request) {
          const worker = okWorkerResult(request);
          delete worker.complianceEvidence?.enforcement;
          return worker;
        },
      },
      synthesizer: new DeterministicSynthesizer(),
    });

    expect(result.complianceSummary.tier).toBe("degraded");
    expect(
      result.complianceSummary.workerCompliance[0]?.compliance.degradedReason,
    ).toContain("runtime enforcement source not recorded");
  });

  test("marks explicit runtime violation evidence non-compliant", async () => {
    const result = await runPanel(panelRequest(), {
      runner: {
        async runWorker(request) {
          const worker = okWorkerResult(request);
          worker.complianceEvidence!.enforcement!.violationEvidence = [
            "write tool completed despite deny policy",
          ];
          return worker;
        },
      },
      synthesizer: new DeterministicSynthesizer(),
    });

    expect(result.complianceSummary.tier).toBe("non-compliant");
    expect(
      result.complianceSummary.workerCompliance[0]?.compliance.degradedReason,
    ).toContain("write tool completed despite deny policy");
  });
});

describe("containment derivation", () => {
  test("derives no-shell when tools are absent or mode is none", () => {
    expect(deriveContainment(undefined)).toBe("no-shell");
    expect(
      deriveContainment({ mode: "none", allow: ["Bash"] }),
    ).toBe("no-shell");
    expect(
      deriveContainment({ mode: "read-only", allow: ["Read", "Grep"] }),
    ).toBe("no-shell");
  });

  test("derives allowlist-enforced when bash is allowed", () => {
    expect(
      deriveContainment({ mode: "read-only", allow: ["Read", "Bash"] }),
    ).toBe("allowlist-enforced");
  });

  test("makes no containment claim for full tool mode", () => {
    expect(deriveContainment({ mode: "full" })).toBeUndefined();
  });
});
