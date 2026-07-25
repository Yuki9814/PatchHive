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

Workspace and scanner files are untrusted input:

- workspace imports are capped at 1 MB and structurally validated
- scanner imports are capped at 1 MB, 250 findings, and bounded field lengths
- versioned JSON must declare agent-hygiene and its version; future schemas are rejected
- legacy output is labeled unverified rather than treated as declared provenance
- SARIF must be 2.1.0, use supported levels, and identify the agent-hygiene driver
- producer scope fingerprints correlate JSON and SARIF without importing runner roots
- legacy JSON roots are hashed only as a compatibility fallback; SARIF roots are ignored
- absolute or traversing finding paths are rejected
- fingerprint collisions fail closed and reruns supersede only the same opaque scope
- imported scanner facts stay immutable apart from their explicit triage state
- normalized fields render as React text, not injected HTML
- imported Markdown cannot create automatic mentions, issue links, or external links
- evidence links allow only credential-free HTTP(S)
- incomplete workspace provenance is reopened and cannot be deleted through reducer actions
- dangling workspace references are repaired and critical duplicate IDs are rejected
- incomplete scans cannot silently become a ready handoff

The production content security policy disables all network connections; local
development permits only the Vite loopback WebSocket used for hot reload.
GitHub Actions are pinned to immutable commits, the lockfile uses the official
npm registry, and CI runs the full dependency audit.

## User responsibilities

Do not paste credentials, private keys, access tokens, private customer data, or
unsanitized proprietary source. Treat browser profiles and downloaded workspace
exports as sensitive. Review handoff Markdown before sharing it.

## Supported versions

Security fixes target the latest released minor version. Older previews should
be upgraded before reporting a compatibility-only defect.
