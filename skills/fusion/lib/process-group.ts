import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

// Harness processes run in their own process group so that stopping one also
// stops the shells, hooks and servers it started, even when the harness does
// not clean them up itself. Signalling only the direct
// child orphans those descendants, and a descendant that inherited a stdout
// pipe keeps the invocation from returning after its timeout (ADR 0049).
// Descendants that call setsid() themselves leave the group; that residual
// needs OS-level containment and is out of scope.

const groupSignalsSupported = process.platform !== "win32";
const defaultGraceMs = 2_000;
const killConfirmMs = 1_000;
const pollMs = 50;
const activeGroups = new Set<ChildProcess>();
let exitHookInstalled = false;

export function spawnProcessGroup(
  command: string,
  args: string[],
  options: SpawnOptions,
): ChildProcess {
  const child = spawn(command, args, {
    ...options,
    detached: groupSignalsSupported,
  });
  if (child.pid !== undefined) {
    activeGroups.add(child);
    installExitHook();
  }
  return child;
}

/**
 * Asks the harness to stop with SIGTERM to the leader alone, so a harness that
 * shuts down its own children gets to do so; whatever is still in the group
 * after the grace period (including descendants of a leader that already
 * exited) is then killed with SIGKILL.
 */
export async function terminateProcessGroup(
  child: ChildProcess,
  graceMs = defaultGraceMs,
): Promise<void> {
  try {
    if (isRunning(child)) child.kill("SIGTERM");
    if (await waitForGroupExit(child, graceMs)) return;
    if (!signalGroup(child, "SIGKILL")) return;
    await waitForGroupExit(child, killConfirmMs);
  } finally {
    activeGroups.delete(child);
  }
}

/** Stops every group this process still owns, e.g. on runtime disposal. */
export async function terminateActiveProcessGroups(): Promise<void> {
  await Promise.all([...activeGroups].map((child) => terminateProcessGroup(child)));
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (child.pid === undefined) return false;
  if (!groupSignalsSupported) {
    return isRunning(child) && child.kill(signal);
  }
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function groupAlive(child: ChildProcess): boolean {
  if (child.pid === undefined) return false;
  if (!groupSignalsSupported) return isRunning(child);
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

async function waitForGroupExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (groupAlive(child)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return true;
}

// Last resort for an abrupt exit: only synchronous work runs in "exit".
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const child of activeGroups) {
      try {
        signalGroup(child, "SIGKILL");
      } catch {
        // Nothing else can be done while the process is exiting.
      }
    }
  });
}
