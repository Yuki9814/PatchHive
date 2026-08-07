# PatchHive

[![CI](https://github.com/Yuki9814/PatchHive/actions/workflows/ci.yml/badge.svg)](https://github.com/Yuki9814/PatchHive/actions/workflows/ci.yml)
[![Pages](https://github.com/Yuki9814/PatchHive/actions/workflows/pages.yml/badge.svg)](https://github.com/Yuki9814/PatchHive/actions/workflows/pages.yml)

PatchHive is a browser-only workbench for open-source maintainers. It turns issue
context and scanner results into a structured mission: evidence, triage status,
human approval gates, and a concise Markdown handoff.

[Open the live demo](https://yuki9814.github.io/PatchHive/)

PatchHive is intentionally local-first:

- no backend or telemetry
- no OAuth or GitHub API calls
- no model execution
- no automatic external posting
- one versioned browser-storage workspace, kept under `patchhive.workspace.v1`

## Scanner-to-maintainer workflow

PatchHive v0.6 accepts native JSON and SARIF 2.1.0 produced by
[agent-hygiene](https://github.com/Yuki9814/agent-hygiene). The complete file is
parsed in the browser and is not uploaded.

```bash
agent-hygiene scan . --format json --portable \
  --source-revision "$(git rev-parse --verify HEAD)" \
  --output agent-hygiene.json
# or
agent-hygiene scan . --format sarif --output agent-hygiene.sarif
```

In PatchHive:

1. Open a mission and find **Scanner intake** in the inspector.
2. Paste the output or choose the local file.
3. Review the preview. Nothing enters the workspace before confirmation.
4. Import normalized findings into the current stage.
5. Triage high-severity findings. Accepted risks require a non-empty resolution
   note. A fixed finding resolves only after a complete rerun with the same
   opaque scan scope no longer reports it.
6. Attach follow-up evidence and complete the human approval gates.
7. Choose the full evidence record, GitHub Issue, or GitHub Pull Request
   format, then copy or download the evidence-backed Markdown handoff.

Imported findings keep their format, source filename, declared-or-unverified
producer status, rule ID, fingerprint, normalized identity, scan-completion
status, opaque scope ID, declared source revision, and import time. Absolute
scanner roots are discarded.
A fingerprint is accepted only when it identifies the same normalized finding;
collisions fail closed.

A complete rerun updates only evidence from the same scope. Findings still
present become actionable complete-scan evidence, findings absent from the rerun
become resolved, and unrelated scopes remain blocked. Native JSON derives scope
from `summary.scope_fingerprint` and SARIF from
`run.properties.scopeFingerprint`, so versioned output matches across
formats without exposing a runner path. Legacy JSON root hashing and unscoped
SARIF source filenames remain compatibility fallbacks only.

The agent-hygiene v0.5 Action can emit portable native JSON before its final
severity gate. PatchHive stores its producer and source-revision fields as
declarations, not signatures. The frozen finding/clean-rerun pair and exact
SHA-256 digests are documented in the
[v0.4 interoperability note](docs/interop-v0.4.0.md).

## Local handoff privacy preflight

The Handoff panel offers an optional, local privacy preflight before Markdown
leaves the browser. It is off by default to preserve the existing export
workflow. When enabled, the preview, clipboard, and download all use the same
deterministically redacted Markdown.

The bounded check recognizes high-confidence PEM private-key headers and blocks,
GitHub tokens, AWS access key IDs, bearer tokens, JSON Web Tokens, credential
URLs using HTTP(S), PostgreSQL, MySQL, MariaDB, Redis, or MongoDB schemes, and
explicit secret, token, password, or API-key assignments. An unclosed supported
private-key header is masked through the end of the Markdown while preserving
line breaks. Findings show only a category and original line number; matched
values are never displayed in the report. Overlapping matches are coalesced
across their full range and use the highest-confidence contextual mask.
Checked export locks if Markdown exceeds 2,000,000 characters, resolved
findings exceed 500, a credential assignment value exceeds 16,384 characters,
or a quoted credential value is unclosed or ambiguously terminated.

This pattern check is not a secret scanner or a safety guarantee. A zero-match
result does not mean the handoff is safe. Review the redacted preview before
sharing it. The check makes no network request, does not persist its opt-in
state, and does not change the workspace schema.

## Minimum-disclosure maintainer trial

The optional **Maintainer trial** panel turns a completed, partial, or blocked
workflow into a small structured feedback report. A participant records elapsed
minutes, clarity, reuse intent, and one friction area, then explicitly consents
before preview, copy, or download.

PatchHive does not store or send trial answers. The report contains no mission
text, repository identity, browser identity, or free-form response, and it does
not change workspace schema v8. Sharing remains a deliberate manual action.
See the [maintainer trial protocol](docs/maintainer-trial.md) for recruitment,
aggregation, and claim limits. Providing the tool does not count as an external
trial; current external evidence remains `N=0 / not evaluated`.

## What works

- PR Rescue, Issue Intake, and Release Brief mission templates
- local parsing of GitHub issue and pull-request URLs without a network request
- local agent-hygiene JSON/SARIF preview with byte, count, shape, path, and field limits
- evidence provenance and open/accepted/resolved triage states
- deterministic severity-first sorting, severity/triage filters, and 25-item pagination
- fail-closed accepted-risk notes plus an accepted-risk handoff appendix
- complete same-scope rerun proof for resolved scanner findings
- portable agent-hygiene Action JSON intake with declared source revisions
- stages, structured maintainer lanes, findings, and human approval gates
- handoff readiness checks and evidence-source coverage
- opt-in local privacy preflight with deterministic Markdown masking
- consented, minimum-disclosure local trial report preview/copy/download
- full, GitHub Issue, and GitHub Pull Request Markdown copy/download plus
  versioned workspace import/export
- schema v1-v7 migration to schema v8 without changing the browser key
- responsive desktop/mobile workflow and keyboard-accessible controls

Agent lanes are structured planning surfaces, not autonomous agents. External
communication always remains a deliberate maintainer action.

## Trust boundary

Scanner and workspace files are untrusted input. PatchHive:

- accepts at most 1 MB and 250 scanner findings
- marks only versioned producer metadata as declared; legacy output stays visibly unverified
- stores normalized fields rather than the complete scanner document
- keeps imported scanner facts immutable, including after resolution, while
  allowing explicit open/accepted triage changes
- renders finding content through React text nodes, never HTML injection
- rejects absolute paths, parent traversal, fingerprint collisions, and invalid SARIF levels
- only accepts credential-free `http` and `https` evidence links
- rejects future workspace schemas instead of guessing a downgrade
- repairs dangling workspace references, rejects duplicate critical IDs, and
  reopens incomplete imported provenance
- blocks handoff when an accepted scanner risk lacks a non-empty resolution note
- reopens legacy or forged resolved scanner findings without complete-rerun provenance
- neutralizes imported mentions, issue references, and automatic links in Markdown
- fails closed instead of exporting partially checked Markdown when the optional
  privacy preflight exceeds its 2,000,000-character, 500-match, or
  16,384-character credential-value bound, or finds an unclosed or ambiguously
  terminated quoted credential value
- keeps structured trial answers in component memory only and excludes mission,
  repository, browser, and free-form content from the trial report
- ships a production CSP with network connections disabled and uses no runtime
  dependencies beyond React

Do not paste secrets. Review Markdown before sharing it outside the browser.
See [SECURITY.md](SECURITY.md) for the security model and reporting path.

## Run locally

Requires Node.js `^22.22.2`, `^24.15.0`, or `>=26.0.0`.

```bash
npm ci
npm run dev
```

Run the complete release gate:

```bash
npm run check
npx playwright install chromium webkit
npm run test:e2e
npm run benchmark:scanner
```

`npm run check` runs lint, unit/component tests, the production build, a GitHub
Pages asset-path smoke test, and a full high-severity dependency audit.
`npm run test:e2e` runs the maintainer workflows in Chromium and WebKit so
storage recovery, local import, and export behavior stay portable.
`npm run benchmark:scanner` runs the reproducible JSON/SARIF 25, 100, and
250-finding production benchmark. See the
[v0.3.0 benchmark report](docs/benchmarks/v0.3.0-scanner-intake.md).

## Repository map

- `src/agentHygieneImport.ts` — bounded JSON/SARIF normalization
- `src/storage.ts` — workspace validation and schema migration
- `src/workspaceReducer.ts` — mission state transitions and scanner intake
- `src/evidenceView.ts` — deterministic evidence filtering and sorting
- `src/handoff.ts` — approval, scanner, and evidence export gates
- `src/trialReport.ts` — minimum-disclosure trial report contract
- `scripts/scanner-benchmark.mjs` — reproducible scanner-scale benchmark
- `e2e/patchhive.spec.ts` — browser-level maintainer workflows
- `.github/workflows/pages.yml` — production Pages artifact deployment
- `.github/workflows/release.yml` — verified Pages archive and checksum release

## Project status

v0.6 is a maintained preview. Current constraints are deliberate:

- no remote repository fetch or authenticated GitHub integration
- no cross-device sync
- Markdown is the only maintainer-facing export
- scanner imports support agent-hygiene, not arbitrary SARIF producers
- external maintainer trial evidence remains `N=0`; no adoption, completion-rate,
  or usability claim has been accepted

See [ROADMAP.md](ROADMAP.md), [CONTRIBUTING.md](CONTRIBUTING.md), and
[MAINTAINERS.md](MAINTAINERS.md) for planned work and ownership.

## License

MIT
