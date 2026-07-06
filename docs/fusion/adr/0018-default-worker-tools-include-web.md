# ADR 0018: Default Worker Tools Include Web Access

## Status

Accepted

Amends ADR 0006.

## Context

ADR 0006 set the default worker tool policy to read-only, framed around code
and repository tasks. OpenRouter Fusion gives every panelist `web_search` and
`web_fetch`. Fusion is intended as a general deliberation skill for research,
design, and review tasks, not only code-context work, and web-blind panelists
systematically miss current information on research questions.

## Decision

The default worker tool policy is read-only local access plus web search and
web fetch, where the harness provides them. Edit and write operations,
destructive commands, and recursive delegation remain denied by default,
unchanged from ADR 0006 and ADR 0011.

Same-panel tool parity, provenance recording of tool-policy differences, and
adapter limitation reporting from ADR 0006 remain in force. If a harness cannot
provide web tools, the difference is recorded and warned about rather than
failing the panel.

## Consequences

Default panels match OpenRouter Fusion's research capability, at the cost of
higher latency and cost variance and less run-to-run reproducibility than
web-blind panels. Callers who want web-blind workers (for example, pure code
review on a fixed tree) can restrict the tool policy explicitly.

`read-only` in the portable contract means "cannot mutate state", not "cannot
reach the network"; the contract's `ToolsPolicy.allow`/`deny` lists express the
web tools.
