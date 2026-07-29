# Changelog

## 0.5.1 - 2026-07-29

- Replace the bounded-backtracking JWT pattern with one forward,
  delimiter-driven scan after the v0.5.0 release gate measured 2.14 seconds
  against its 2.00-second Ubuntu budget.
- Preserve the existing JWT word-boundary and segment-length contract,
  including a following fourth segment and delimiter-free chained tokens,
  while using a fixed-size header window and masking the complete matched
  signature run without promoting incomplete nested headers to findings.
- Add lower/upper segment-boundary, partial-match, extra-segment, adjacent-token,
  prefix-density, and separator-density regressions. The 2,000,000-character
  prefix and separator cases now complete with substantial release-gate margin.

## 0.5.0 - 2026-07-29

- Add an optional, entirely local privacy preflight for final handoff Markdown.
  When enabled, preview, clipboard, and download use the same deterministic
  masks for bounded, high-confidence credential patterns while the findings
  list exposes only category and original line number.
- Keep the preflight setting ephemeral and schema-neutral. Default-off exports
  remain compatible. Checked export locks on input, match-count, or
  credential-value overflow, and on an unclosed or ambiguously terminated
  quoted credential value, rather than exporting partially checked Markdown.
- Coalesce overlapping findings across the complete sensitive range, scan
  private-key headers in bounded forward time, and mask an unclosed supported
  header through the end of the Markdown.
- Bound credential-name, credential-value, credential-URL-component, and
  JWT-segment matching so delimiter-free near-limit input remains linear and
  responsive. Oversized or unclosed credential assignment values now lock
  checked export instead of producing a partial mask; quoted values honor
  escaped quotes and require a clear terminator after the real closing quote.
- Preserve private-key line breaks without allocating an intermediate array
  proportional to the number of line breaks.
- Recognize credential-bearing HTTP(S), PostgreSQL, MySQL, MariaDB, Redis, and
  MongoDB URLs plus explicit alphabetic password and passwd assignments while
  continuing to ignore configured placeholders and environment references.
- Document that this pattern check is not a safety guarantee and that a
  zero-match result still requires manual review before sharing.

## 0.4.1 - 2026-07-28

- Classify browser workspace loads as missing, valid, migrated, corrupt,
  future-schema, or unavailable, and classify writes as saved, conflict,
  quota, or unavailable without changing schema v8 or
  `patchhive.workspace.v1`.
- Preserve the exact last-read localStorage string as a compare-before-write
  and compare-before-remove expectation. Other-tab storage events lock
  automatic save, import, and ordinary reset; a conflict keeps the current tab
  in memory and offers a current backup or explicit reload instead of silently
  overwriting the newer stored value.
- Isolate corrupt and future-schema payloads without rendering or automatically
  overwriting them, including under React StrictMode. Import and ordinary reset
  stay locked until the user explicitly discards the isolated payload.
- Add an accessible recovery banner with a lossless JSON recovery envelope for
  the original localStorage string, a current in-memory workspace backup,
  explicit discard-and-reset, and manual save retry after quota or
  storage-access failures.
- Reject workspace JSON deeper than 64 levels before parsing, treat empty or
  structurally hostile saved strings as corrupt without coercing untrusted
  values, and preserve the original string for recovery.
- Keep the workspace usable in memory after `QuotaExceededError` or
  `SecurityError`, while making failed persistence visible and never reporting
  a browser save that did not succeed.

## 0.4.0 - 2026-07-27

- Remove manual resolution for imported scanner findings. A finding now enters
  `resolved` only when a complete rerun with the same opaque scope no longer
  contains its normalized identity.
- Add explicit `complete-rerun` provenance and declared source revisions to the
  workspace, UI, and Markdown handoff while retaining the original finding
  source separately from the resolving rerun.
- Migrate workspace schemas v1-v7 to schema v8. Legacy or forged resolved
  scanner findings without rerun provenance reopen instead of silently
  unblocking handoff.
- Accept agent-hygiene v0.5 portable Action JSON and publish a byte-pinned
  finding/clean-rerun fixture pair with exact cross-project SHA-256 checks.
- Add an in-product command path from the agent-hygiene CLI or Action artifact
  to local scanner preview without adding network access or dependencies.
- Keep imported scanner evidence immutable after resolution so the local
  handoff cannot silently discard its finding history.
- Restore Vite development styles with a development-only CSP exception while
  keeping the production Pages policy at `style-src 'self'` and
  `connect-src 'none'`.
- Keep external maintainer trial status at `N=0 / not evaluated`; the fixture
  pair is interoperability evidence, not adoption or independent validation.

## 0.3.0 - 2026-07-26

- Require a non-empty resolution note before an imported scanner risk can enter
  the accepted state, enforce the rule in UI, reducer, workspace migration, and
  handoff gates, and neutralize note Markdown during export.
- Migrate workspace schemas v1-v6 to schema v7 while preserving accepted v6
  risks without inventing notes; those records remain blocked until documented.
- Add deterministic severity-first evidence sorting, severity and triage
  filters, 25-item pagination, indexed list lookups, memoized derived state, and
  lazy Markdown preview rendering.
- Add reproducible JSON/SARIF fixtures and production benchmarks at 25, 100,
  and 250 findings with p50/p95 timing and Chromium heap observations.
- Expand Chromium E2E coverage with a 250-finding CI smoke, acceptance-note
  reload, and mismatched-scope incomplete-scan blocking.
- Record external maintainer trial status honestly as `N=0, not accepted`; no
  usability, completion-rate, adoption, or ecosystem claim is made.

## 0.2.0 - 2026-07-26

- Add bounded local import and preview for agent-hygiene JSON, schema v1 JSON,
  and SARIF 2.1.0.
- Preserve normalized provenance, declared-or-unverified producer status,
  privacy-safe scan scope, severity, and maintainer triage without storing
  absolute scan roots.
- Prefer agent-hygiene's repository scope fingerprint for cross-format
  JSON/SARIF identity;
  keep legacy JSON root hashing and source-name scoping only as compatibility fallbacks.
- Reject fingerprint collisions, absolute or traversing paths, and unsupported
  SARIF levels; derive local identity for fingerprint-free legacy findings.
- Turn incomplete scans and untriaged high-severity findings into explicit
  Review Agent and handoff blockers.
- Upsert same-scope reruns without clearing unrelated incomplete scans or
  leaving prior incomplete findings permanently locked.
- Migrate workspace schema v1-v5 to v6 while keeping
  `patchhive.workspace.v1` compatible.
- Repair workspace references, reject duplicate critical IDs, reopen forged
  incomplete triage, and enforce incomplete deletion locks in the reducer.
- Validate evidence URLs, render imported scanner content only as text, and
  neutralize mentions and automatic links in exported Markdown.
- Add a restrictive content security policy, remove external font requests,
  disable production network connections, and verify production Pages paths.
- Replace the broken legacy source deployment with an artifact-based GitHub
  Pages workflow.
- Pin GitHub Actions by commit, split release verification from its write-token
  publisher, enable dependency updates, and clear the full high-severity audit.
- Expand unit, component, migration, security, and Chromium end-to-end coverage.

## 0.1.0 - 2026-07-22

- Publish the local-first maintainer workbench as a documented OSS release.
- Validate nested workspace import data before it reaches application state.
- Add CI for lint, unit tests, production builds, and Chromium workflow tests.
- Add contributor, security, and license documentation.
- Keep generated Playwright output out of source control.
