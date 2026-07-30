# Security policy

## Reporting

Use GitHub private vulnerability reporting for import-validation bypasses,
unsafe content rendering, dependency compromise, or local workspace data loss.
Include the affected version, browser, minimal sanitized input, and reproduction
steps. Do not open a public issue for an unpatched vulnerability.

The maintainer will acknowledge a complete report within seven days and will
coordinate disclosure after a fix or documented mitigation is available.

## Security model

PatchHive is a static browser application. It has no backend, authentication,
telemetry, model execution, remote repository fetch, or automatic posting.
Project context stays in browser storage unless a user explicitly downloads or
copies it.

Browser storage is not assumed to be durable or available. Corrupt and
future-schema payloads are isolated without rendering or automatic overwrite;
import and ordinary reset remain locked until explicit discard. Quota and
storage-access failures keep the current workspace usable in memory while a
visible warning offers a local backup and manual retry. Recovery downloads can
contain the complete original payload and must be handled as sensitive data.
The lossless recovery envelope stores that payload as a JSON string so escaped
characters and unmatched UTF-16 surrogate code units can be recovered exactly.

Normal saves and explicit discard compare the exact last successfully read or
written localStorage string immediately before writing or removing it. A
`storage` event from another tab also locks this tab in memory-only mode, where
the user can download the current workspace or reload the stored value. If the
initial read was unavailable, PatchHive requires fresh explicit confirmation
for every write attempt until that unknown baseline is successfully replaced.
Web Storage does not provide an atomic
compare-and-swap operation: the re-read plus cross-tab event handling narrows
the conflict window but cannot guarantee strong atomicity if another writer
changes the same key between the final comparison and `setItem`/`removeItem`.
Avoid editing the same workspace in multiple tabs when lossless concurrency is
required.

Workspace and scanner files are untrusted input:

- workspace imports are capped at 1 MB and structurally validated
- workspace JSON is rejected before parsing when nesting exceeds 64 levels
- scanner imports are capped at 1 MB, 250 findings, and bounded field lengths
- versioned JSON must declare agent-hygiene and its version; future schemas are rejected
- legacy output is labeled unverified rather than treated as declared provenance
- SARIF must be 2.1.0, use supported levels, and identify the agent-hygiene driver
- producer scope fingerprints correlate JSON and SARIF without importing runner roots
- source revisions are bounded declarations, not signatures or authenticity proof
- legacy JSON roots are hashed only as a compatibility fallback; SARIF roots are ignored
- absolute or traversing finding paths are rejected
- fingerprint collisions fail closed and reruns supersede only the same opaque scope
- imported scanner facts stay immutable apart from their explicit triage state
- accepted scanner risks require a bounded, non-empty resolution note; imported
  workspaces with missing notes remain blocked
- scanner findings can resolve only through a complete same-scope rerun;
  legacy or forged resolved records without that provenance reopen on migration
- normalized fields render as React text, not injected HTML
- imported Markdown cannot create automatic mentions, issue links, or external links
- evidence links allow only credential-free HTTP(S)
- imported workspace provenance cannot be deleted through reducer actions,
  including after a finding is resolved
- dangling workspace references are repaired and critical duplicate IDs are rejected
- incomplete scans, undocumented accepted risks, and unevidenced resolved
  findings cannot silently become a ready handoff
- the optional handoff privacy preflight runs only on the final local Markdown,
  reports category and original line number without displaying matched values,
  and applies deterministic masks to preview, clipboard, and download
- maintainer-trial answers remain in component memory only, require explicit
  consent before generation, and use fixed-choice fields so the report contains
  no mission, repository, browser, or free-form content
- overlapping privacy matches coalesce across their full range under the
  highest-confidence contextual mask; supported unclosed private-key headers
  are masked through the end of the Markdown while preserving line breaks
- private-key matching is a bounded forward scan; a preflight that exceeds its
  input, match-count, or 16,384-character credential-value bound locks export,
  as does an unclosed or ambiguously terminated quoted credential value
- credential assignment names and values plus credential URL components have
  explicit scan-length bounds; JWT candidates use one forward pass and a
  fixed-size header window so malformed near-limit input cannot trigger
  repeated suffix scans
- private-key line-break preservation removes non-line-break runs directly
  instead of materializing a per-line-break match array

The production content security policy disables all network connections; local
development permits only the Vite loopback WebSocket used for hot reload and
inline styles injected by Vite. The production build gate rejects both
development-only exceptions.
GitHub Actions are pinned to immutable commits, the lockfile uses the official
npm registry, and CI runs the full dependency audit.

## User responsibilities

Do not paste credentials, private keys, access tokens, private customer data, or
unsanitized proprietary source. Treat browser profiles, recovery envelopes, and
downloaded workspace exports as sensitive. Review handoff Markdown before
sharing it. The privacy preflight is off by default and recognizes only
configured high-confidence patterns, including credential-bearing HTTP(S),
PostgreSQL, MySQL, MariaDB, Redis, and MongoDB URLs. Explicit password and
passwd assignments are masked at 12 characters even when alphabetic, except
for configured placeholders and environment references. An unclosed or
over-16,384-character credential assignment locks checked export instead of
partially masking its value. Quoted assignments honor escaped quotes and
require a terminating delimiter after the real closing quote; ambiguous
suffixes also lock checked export. False negatives are possible, and a
zero-match result is not proof that the handoff is safe.

## Supported versions

Security fixes target the latest released minor version. Older previews should
be upgraded before reporting a compatibility-only defect.
