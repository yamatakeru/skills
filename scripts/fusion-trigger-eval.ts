// Paid trigger check for the Fusion skill description (see docs/fusion/runbook.md).
// For each SKILL.md variant and case, runs one isolated Claude Code turn with
// only that skill installed at project scope and records whether the model's
// first action invokes it. Built-in Claude Code skills (for example
// code-review) remain present as competitors; user-level skills are excluded.
import { mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type TriggerCase = { id: string; expect: boolean; prompt: string };
type Variant = { label: string; path: string };

const usage =
  "Usage: bun scripts/fusion-trigger-eval.ts --skill <label>=<SKILL.md> [--skill ...] [--model sonnet] [--repeat 1] [--cases scripts/fusion-trigger-cases.json]";

function parse(argv: string[]) {
  const variants: Variant[] = [];
  let model = "sonnet";
  let repeat = 1;
  let cases = "scripts/fusion-trigger-cases.json";
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(usage);
    i += 1;
    if (flag === "--skill") {
      const split = value.indexOf("=");
      if (split <= 0) throw new Error(usage);
      variants.push({ label: value.slice(0, split), path: resolve(value.slice(split + 1)) });
    } else if (flag === "--model") model = value;
    else if (flag === "--repeat") repeat = Number(value);
    else if (flag === "--cases") cases = value;
    else throw new Error(usage);
  }
  if (variants.length === 0 || !Number.isInteger(repeat) || repeat < 1) throw new Error(usage);
  return { variants, model, repeat, cases };
}

async function firstSkillCall(skillFile: string, model: string, prompt: string): Promise<string | null> {
  const project = await mkdtemp(join(tmpdir(), "fusion-trigger-"));
  try {
    await mkdir(join(project, ".claude", "skills", "fusion"), { recursive: true });
    await copyFile(skillFile, join(project, ".claude", "skills", "fusion", "SKILL.md"));
    Bun.spawnSync(["git", "init", "-q"], { cwd: project });
    const proc = Bun.spawn(
      ["claude", "-p", "--setting-sources", "project", "--output-format", "stream-json", "--verbose", "--max-turns", "1", "--model", model, prompt],
      { cwd: project, stdout: "pipe", stderr: "ignore" },
    );
    const lines = (await new Response(proc.stdout).text()).split("\n");
    await proc.exited;
    for (const line of lines) {
      if (!line.includes('"tool_use"')) continue;
      const event = JSON.parse(line) as { type?: string; message?: { content?: Array<{ type?: string; name?: string; input?: { skill?: string } }> } };
      if (event.type !== "assistant") continue;
      for (const block of event.message?.content ?? []) {
        if (block.type === "tool_use") return block.name === "Skill" ? (block.input?.skill ?? "Skill") : block.name ?? "tool";
      }
    }
    return null;
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

const options = parse(Bun.argv.slice(2));
const cases = (await Bun.file(options.cases).json()) as TriggerCase[];
for (const variant of options.variants) {
  let correct = 0;
  let total = 0;
  for (const item of cases) {
    const outcomes: string[] = [];
    for (let n = 0; n < options.repeat; n += 1) {
      const action = await firstSkillCall(variant.path, options.model, item.prompt);
      const fired = action === "fusion";
      total += 1;
      if (fired === item.expect) correct += 1;
      outcomes.push(fired ? "fired" : `no(${action ?? "answer"})`);
    }
    console.log(`${variant.label}\t${item.expect ? "should" : "should-not"}\t${item.id}\t${outcomes.join(",")}`);
  }
  console.log(`${variant.label}\tscore\t${correct}/${total}\tmodel=${options.model}`);
}
