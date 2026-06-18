This file is supplementary guidance for Fusion Council. The executable runtime protocol remains in `../SKILL.md`. Do not rely on this file being read at runtime.

# Role-Based Council

Role-based council is an OpenCode-oriented extension. It is useful for agentic coding and design review, but it is less literal to OpenRouter Fusion than blind panel because each role intentionally biases the subagent's lens.

## Roles

- `fusion-scout`: gathers repository facts, relevant files, conventions, and missing context. Read-only.
- `fusion-architect`: proposes architecture, tradeoffs, migration paths, and minimal implementation strategy. Read-only.
- `fusion-critic`: challenges assumptions, finds bugs, risks, edge cases, security issues, and test gaps. Read-only.
- `fusion-verifier`: plans and, when allowed, runs targeted checks such as tests, lint, typecheck, build, or repro commands. No edits.

## When To Use

Use role-based council when the task benefits from explicit division of labor:

- architecture or migration planning
- risky implementation plans
- complex bug triage
- code review with correctness or security concerns
- tasks where verification evidence materially changes the answer

Prefer blind panel when the goal is independent convergence on the same prompt.

## Role Sets

- `--roles scout,critic`: quick context plus risk review.
- `--roles architect,critic`: competing design and critique.
- `--roles scout,architect,critic`: strong design review without command execution.
- `--roles scout,architect,critic,verifier`: full review when verification is useful and allowed.

## OpenCode Permission Boundaries

Keep role subagents read-only by default:

- Subagents should not edit files.
- `fusion-verifier` may run only safe, targeted, allowed commands.
- Avoid broad or destructive commands.
- Parent agent performs any final implementation after synthesis.
- Subagents should not spawn further tasks or recursive councils.

## Hidden Agent Caveats

Hidden agent availability, model names, and task permissions are environment-dependent. If role subagents cannot be spawned, fall back to internal council and disclose the degradation. If model-specific frontmatter does not match the user's environment, remove or replace the `model:` line.
