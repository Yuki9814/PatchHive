# agent-hygiene interoperability — v0.4.0

PatchHive v0.4 consumes the portable native JSON emitted by agent-hygiene
v0.5.0. This handoff remains local: one tool writes a file, and the browser
previews that file without a backend, OAuth, telemetry, or model execution.

## Producer workflow

From a local checkout:

```bash
agent-hygiene scan . \
  --format json \
  --portable \
  --source-revision "$(git rev-parse --verify HEAD)" \
  --output agent-hygiene.json
```

In GitHub Actions, configure the exact agent-hygiene v0.5.0 Action with a
`json` path and upload `${{ steps.hygiene.outputs.json }}` in a separate
`if: always()` artifact step. The report is created before the final policy
gate, so a blocked run can still provide local maintainer evidence.

The portable report omits the absolute checkout root. Its producer version,
opaque scope fingerprint, and source revision are declarations, not signatures.

## Consumer workflow

1. Preview the JSON in **Scanner intake**.
2. Confirm the normalized finding import.
3. For a risk that remains intentionally present, use **Accept risk** and write
   a bounded rationale.
4. For a fixed risk, run agent-hygiene again at the new revision and import the
   complete same-scope report.
5. PatchHive marks a prior finding resolved only when it is absent from that
   rerun. The handoff retains the original finding source and separately
   records the rerun source and declared revision.

Manual `resolved` transitions are rejected in the reducer. Schema v8 also
reopens legacy or forged resolved scanner records that lack
`complete-rerun` provenance. Imported records stay immutable after resolution;
starting a fresh workspace is the explicit way to discard the local history.

## Frozen public fixtures

The committed pair under
[`fixtures/agent-hygiene/v0.5.0`](../fixtures/agent-hygiene/v0.5.0)
is byte-for-byte identical to the agent-hygiene v0.5.0 fixture pair:

| File | Findings | Source revision | SHA-256 |
| --- | ---: | --- | --- |
| `findings.json` | 1 high | `1111111111111111111111111111111111111111` | `3b3addc2a8c9d50864554ffac6a99ba463a266448429134c6a2871e90251abe6` |
| `clean-rerun.json` | 0 | `2222222222222222222222222222222222222222` | `7471bcca1753b8d49068f037bc6797fe75a6a530ef29515b81dc28619548bf66` |

The test suite verifies the hashes, imports both reports, rejects a manual
resolution attempt, and accepts the clean same-scope rerun as resolution
evidence.

This is synthetic interoperability evidence only. External maintainer trial:
**N=0 / not evaluated**. It does not represent a consenting repository,
independent review, adoption, completion-rate result, or usability claim.
