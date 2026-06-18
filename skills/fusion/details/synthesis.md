This file is supplementary guidance for Fusion. The executable runtime protocol
remains in `../SKILL.md`. Do not rely on this file being read at runtime.

# Synthesis

Fusion synthesis compares independent answers to the same prompt. It should not
choose one panelist verbatim or average away important disagreements.

## Required Findings

1. **Consensus**: facts, diagnoses, or recommendations that independent
   panelists converged on.
2. **Contradictions**: mutually exclusive claims or recommendations.
3. **Partial coverage**: important topics only some panelists addressed.
4. **Unique insights**: valuable observations raised by one panelist.
5. **Blind spots**: relevant questions or evidence nobody addressed.

## Final Answer

Lead with high-confidence consensus, preserve contradictions, incorporate unique
insights when justified, and explicitly name blind spots that affect confidence.
For code or artifact tasks, prefer verification evidence over persuasive prose.
