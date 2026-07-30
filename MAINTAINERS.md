# Maintainers

## Current maintainer

- [@Yuki9814](https://github.com/Yuki9814) — repository owner, product direction,
  security triage, review, releases, and GitHub Pages operations

No additional maintainers or adoption claims are implied.

## Decision model

The repository owner is responsible for:

- preserving the documented local-first and no-credentials boundary
- reviewing changes to import schemas, storage migration, and handoff gates
- keeping CI, dependency audit, and Pages deployment healthy
- publishing release notes and immutable tags
- coordinating private vulnerability reports

Routine fixes may be merged after the full verification gate passes. Product
boundary, storage compatibility, or security-model changes require an issue or
pull request that records the tradeoff.

## Release checklist

1. Run `npm ci`, `npm run check`, and `npm run test:e2e`.
2. Review the changelog, version, migration fixtures, and security impact.
3. Merge through a green pull request.
4. Verify the Pages workflow serves built JavaScript from the merged commit.
5. Create the signed or annotated release tag and let the least-privilege
   release workflow publish the verified Pages archive and checksums.
6. Download the published archive, verify `SHA256SUMS`, and smoke-test its
   `index.html` and relative assets.

## External trial evidence

Follow the [minimum-disclosure trial protocol](docs/maintainer-trial.md).
Generated local reports are tooling evidence, not external validation. Count a
trial only after a consenting external maintainer returns the reviewed report,
and publish sample size and recruitment limits with any aggregated findings.
