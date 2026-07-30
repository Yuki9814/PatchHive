# Contributing

PatchHive accepts focused changes that improve evidence quality, import safety,
approval clarity, workspace portability, or maintainer handoffs while
preserving the local-first boundary.

## Development

Use Node.js 22 or newer.

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
```

The complete `npm run check` gate must remain green: ESLint, unit/component
tests, TypeScript and Vite production build, Pages asset smoke test, and the
high-severity npm audit.

## Pull requests

A pull request should:

- explain the maintainer problem and smallest coherent solution
- include focused tests for success, rejection, and migration paths
- call out storage schema or trust-boundary changes
- update documentation when behavior changes
- avoid unrelated generated output

For scanner imports, preserve these invariants:

- parsing is local and preview-first
- future schemas fail closed
- input size, list count, and field length stay bounded
- producer scope fingerprints are preferred and SARIF roots are never consumed
- legacy JSON roots never persist and repository paths stay relative without parent traversal
- fingerprints only deduplicate identical normalized findings; collisions fail closed
- producer declarations, unverified legacy output, and scan scopes remain distinct
- imported text is never sent to an HTML sink
- imported Markdown cannot trigger mentions or automatic links
- incomplete scans remain visible blockers
- accepted scanner risks require a non-empty, bounded resolution note
- scanner findings enter `resolved` only after a complete same-scope rerun no longer reports them
- source revisions remain bounded declarations and are never presented as signatures
- a complete rerun supersedes only evidence from the same scan scope
- imported scanner content never writes a ready-to-publish maintainer comment
- maintainer-trial answers stay outside workspace storage, require explicit
  consent, and never include mission, repository, browser, or free-form content

Changes to the agent-hygiene contract must update the byte-pinned files under
`fixtures/agent-hygiene/`, their SHA-256 assertions, and the complete-rerun
reducer test. Synthetic fixtures are not external trial evidence.

Do not add a backend, OAuth, remote posting, analytics, or model execution
without first opening a proposal that changes the documented product boundary.

## Releases

Only the maintainer publishes releases. A release requires the local gate,
Chromium end-to-end tests, green pull-request checks, a changelog entry, and a
verified Pages deployment from the merged commit. The tag workflow verifies
source with read-only permissions; only the final artifact-publishing job gets
`contents: write`, and that job never checks out or executes tagged source.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
