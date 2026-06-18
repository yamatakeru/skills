This file is supplementary guidance for Fusion Council. The executable runtime protocol remains in `../SKILL.md`. Do not rely on this file being read at runtime.

# Synthesis Guidance

Fusion Council is not a majority-vote mechanism. The parent agent compares independent outputs, preserves disagreement, and writes a final answer grounded in the structured synthesis.

## Required Dimensions

- **Consensus**: points independently supported by all or nearly all participants. Treat these as high-confidence, but still check them against evidence.
- **Contradictions**: mutually exclusive claims, incompatible recommendations, or conflicting interpretations. Do not smooth these away.
- **Partial coverage**: important aspects addressed by only some participants.
- **Unique insights**: valuable points raised by a single participant. Do not discard them just because they are minority observations.
- **Blind spots**: obvious questions, evidence, constraints, or risks that nobody addressed.

## Source Attribution

Attribute findings to their source when useful:

- `panelist-1`, `panelist-2`, etc. for blind panel outputs.
- `scout`, `architect`, `critic`, `verifier` for role-based council outputs.
- Verification commands and tool outputs separately from model judgement.

Avoid implying that a claim was independently confirmed if it came from only one participant.

## Track A: Code Or Artifact Tasks

For code, configuration, scripts, migrations, or other artifacts:

- Prefer verified behavior over persuasive prose.
- Compare candidate implementations against the repository constraints.
- Run targeted checks when safe and allowed.
- State what was verified and what remains unverified.
- Integrate the working parts into one coherent recommendation or artifact.

## Track B: Research Or Design Tasks

For research, architecture, policy, product, or design judgement:

- Lead with consensus.
- Include important unique insights.
- Preserve contradictions as uncertainty or competing tradeoffs.
- Name blind spots and evidence that would resolve them.
- Make a recommendation only when the evidence supports one.

## Anti-Patterns

- Choosing the longest or most confident answer without comparison.
- Treating the panel as a simple vote.
- Hiding contradictions to make the final answer cleaner.
- Dropping minority insights before checking their value.
- Failing to distinguish executed verification from speculation.
