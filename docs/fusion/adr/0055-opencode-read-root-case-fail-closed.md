# ADR 0055: Fail Closed on Case-Unsafe OpenCode Read Roots

## Status

Accepted. Supersedes ADR 0054's decision to accept the case-insensitive
read-root match on case-sensitive macOS volumes as a documented residual.
ADR 0054's supported version boundary and type-only pin remain unchanged.

## Context

From OpenCode 2.4 on macOS, `Permission.evaluate` matches `read`, `edit` and
`external_directory` resources without case over the whole path (upstream
`79bd2c6f`). Fusion expresses each `--read-root` as `external_directory`
allows for `<root>` and `<root>/**`, so the allow also matches every path that
differs from the root only in letter case, in any component. On a
case-sensitive volume those are different directories. A trailing deny cannot
carve a variant out, because it would match the declared root with the same
case folding. ADR 0054 accepted this as a residual and listed failing closed
as a deferred option; it is now taken.

## Evidence (2026-11-23)

On a temporary Case-sensitive APFS disk image holding `repo/file.txt` and
`REPO/secret.txt`, with `repo` declared as the only read root:

- With the new check bypassed, a real owned `opencode v2.4.0` server answered
  the permission endpoint for `fusion-worker` with `allow` for both
  `repo/file.txt` and `REPO/secret.txt`, and `deny` for an undeclared sibling
  file. The leak is real, not only inferred from source.
- With the check active, the worker failed with
  `OPENCODE_READ_ROOT_CASE_UNSAFE` before session creation; no prompt was
  sent.
- The same check accepted the image's mount point itself (its lookup happens in
  the case-insensitive parent directory) and the default-volume workspace, and
  the free contract check, whose read root is on the default volume, still
  passes against `opencode v2.4.0`.

## Decision

When the OpenCode server folds path-rule case (macOS, OpenCode 2.4 or later),
the OpenCode adapter verifies every declared read root before creating a
session, after the server identity is known and only for tool-using workers
(the no-tools judge carries no read-root rules). For each path component with
cased letters, it compares `lstat` of the component and of its case-swapped
name in the same parent. The root is safe only when every such pair resolves
to the same entry (same device and inode). A case-sensitive lookup, an
existing different variant, or any lookup error, including a missing root,
fails the worker closed with `OPENCODE_READ_ROOT_CASE_UNSAFE`. Paths below the
root need no check, since the root allow already covers them.

The check only reads the filesystem. Other harnesses are unaffected: they do
not apply OpenCode's case folding.

## Considered Options

- **Keep the documented residual** (ADR 0054): leaves a demonstrated read
  outside the declared roots to caller vigilance on a non-default setup.
- **Detect per volume** (filesystem case sensitivity via mount metadata):
  needs platform-specific calls and still has to map every path component to
  its volume; mount points can make a parent and a child differ.
- **Probe each component by its case-swapped name** (chosen): no native
  dependency, no writes, and it checks exactly the lookups the folded rule
  spans.
- **Deny known variants after the allow**: impossible under last-match
  evaluation with the same case folding, as above.

## Consequences

A panel that declares a read root on a case-sensitive macOS volume loses its
OpenCode workers with an explicit error and no model calls; the caller can
move or omit the root, or run without OpenCode workers. A missing read root
now also fails OpenCode workers closed on macOS with OpenCode 2.4+, since it
cannot be verified. Components whose case swap equals the original (no cased
letters) are skipped, since no variant exists for the folded rule to reach.
