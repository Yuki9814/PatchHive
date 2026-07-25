# Changelog

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
