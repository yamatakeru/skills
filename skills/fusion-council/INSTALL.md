# Fusion Council for OpenCode

## Install into a project

Copy the `.opencode` directory into the root of your repository:

```bash
cp -R .opencode /path/to/your/repo/
```

Then either merge `opencode.fusion.example.jsonc` into your existing `opencode.json` or copy it as a starting point:

```bash
cp opencode.fusion.example.jsonc /path/to/your/repo/opencode.jsonc
```

## Model setup

The hidden agents contain commented `model:` lines. Uncomment and replace them with model IDs available in your OpenCode setup.

Use:

```bash
opencode models
```

Typical pattern:

- `fusion-scout`: fast/cheap model
- `fusion-architect`: strongest reasoning/design model
- `fusion-critic`: different provider or strong reviewer model
- `fusion-verifier`: precise coding/test model

If you leave `model:` commented out, OpenCode should use the model of the primary agent that invoked the subagent.

## Usage

In OpenCode, ask for the skill explicitly when needed:

```text
fusion-councilを使って、この設計変更のリスクと実装方針を比較して。
```

or:

```text
このバグ修正方針をfusion-councilでレビューして。実装はまだしないで。
```

For small tasks, do not use the council.
