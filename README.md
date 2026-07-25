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

PatchHive v0.2 accepts native JSON and SARIF 2.1.0 produced by
[agent-hygiene](https://github.com/Yuki9814/agent-hygiene). The complete file is
parsed in the browser and is not uploaded.

```bash
agent-hygiene scan . --format json --output agent-hygiene.json
# or
agent-hygiene scan . --format sarif --output agent-hygiene.sarif
```

In PatchHive:

1. Open a mission and find **Scanner intake** in the inspector.
2. Paste the output or choose the local file.
3. Review the preview. Nothing enters the workspace before confirmation.
4. Import normalized findings into the current stage.
5. Triage high-severity findings, attach follow-up evidence, and complete the
   human approval gates.
6. Copy or download the evidence-backed Markdown handoff.

Imported findings keep their format, source filename, declared-or-unverified
producer status, rule ID, fingerprint, normalized identity, scan-completion
status, opaque scope ID, and import time. Absolute scanner roots are discarded.
A fingerprint is accepted only when it identifies the same normalized finding;
collisions fail closed.

A complete rerun updates only evidence from the same scope. Findings still
present become actionable complete-scan evidence, findings absent from the rerun
become resolved, and unrelated scopes remain blocked. Native JSON derives scope
from `summary.scope_fingerprint` and SARIF from
`run.properties.scopeFingerprint`, so versioned v0.3 output matches across
formats without exposing a runner path. Legacy JSON root hashing and unscoped
SARIF source filenames remain compatibility fallbacks only.

## What works

- PR Rescue, Issue Intake, and Release Brief mission templates
- local parsing of GitHub issue and pull-request URLs without a network request
- local agent-hygiene JSON/SARIF preview with byte, count, shape, path, and field limits
- evidence provenance and open/accepted/resolved triage states
- stages, structured maintainer lanes, findings, and human approval gates
- handoff readiness checks and evidence-source coverage
- Markdown copy/download plus versioned workspace import/export
- schema v1-v5 migration to schema v6 without changing the browser key
- responsive desktop/mobile workflow and keyboard-accessible controls

Agent lanes are structured planning surfaces, not autonomous agents. External
communication always remains a deliberate maintainer action.

## Trust boundary

Scanner and workspace files are untrusted input. PatchHive:

- accepts at most 1 MB and 250 scanner findings
- marks only versioned producer metadata as declared; legacy output stays visibly unverified
- stores normalized fields rather than the complete scanner document
- keeps imported scanner facts immutable while allowing explicit triage changes
- renders finding content through React text nodes, never HTML injection
- rejects absolute paths, parent traversal, fingerprint collisions, and invalid SARIF levels
- only accepts credential-free `http` and `https` evidence links
- rejects future workspace schemas instead of guessing a downgrade
- repairs dangling workspace references, rejects duplicate critical IDs, and
  reopens incomplete imported provenance
- neutralizes imported mentions, issue references, and automatic links in Markdown
- ships a production CSP with network connections disabled and uses no runtime
  dependencies beyond React

Do not paste secrets. Review Markdown before sharing it outside the browser.
See [SECURITY.md](SECURITY.md) for the security model and reporting path.

## Run locally

Requires Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Run the complete release gate:

```bash
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm run check` runs lint, unit/component tests, the production build, a GitHub
Pages asset-path smoke test, and a full high-severity dependency audit.

## Repository map

- `src/agentHygieneImport.ts` — bounded JSON/SARIF normalization
- `src/storage.ts` — workspace validation and schema migration
- `src/workspaceReducer.ts` — mission state transitions and scanner intake
- `src/handoff.ts` — approval, scanner, and evidence export gates
- `e2e/patchhive.spec.ts` — browser-level maintainer workflows
- `.github/workflows/pages.yml` — production Pages artifact deployment
- `.github/workflows/release.yml` — verified Pages archive and checksum release

## Project status

v0.2 is a maintained preview. Current constraints are deliberate:

- no remote repository fetch or authenticated GitHub integration
- no cross-device sync
- Markdown is the only maintainer-facing export
- scanner imports support agent-hygiene, not arbitrary SARIF producers

See [ROADMAP.md](ROADMAP.md), [CONTRIBUTING.md](CONTRIBUTING.md), and
[MAINTAINERS.md](MAINTAINERS.md) for planned work and ownership.

## License

MIT
