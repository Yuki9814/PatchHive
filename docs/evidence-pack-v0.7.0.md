# Evidence Pack v0.7.0

This document defines the local, single-mission Evidence Pack introduced in
PatchHive v0.7. It is an interchange format and a reviewable import path. It is
not a backup, an encrypted archive, a signed release, or a remote-sync
protocol.

## Contract at a glance

- One pack contains one Mission, never the complete browser workspace.
- Export applies mandatory, field-level local cleanup. The exporter must not
  depend on a later reviewer remembering to remove sensitive values or paths.
- A pack is parsed, validated, redaction-checked, canonicalized, hashed, and
  previewed before the user can import it.
- v0.7 accepts only the current workspace schema declared by the pack. Older
  or newer mission shapes fail closed rather than being transformed after the
  digest check.
- The self-check is an integrity check. `authenticity` remains `unverified`.
  A SHA-256 digest obtained independently through a trusted channel can be
  compared to the computed digest and can raise confidence in the bytes, but
  it is not a signature or proof of authorship.
- A confirmed same-id import replaces the local Mission. A confirmed
  different-id import adds it. The candidate is saved against the current
  local-storage expectation before the in-memory workspace dispatch.
- Verification, validation, digest, conflict, quota, or storage failure does
  not change the in-memory or stored workspace.

## Schema example

The following is a representative `patchhive.evidence-pack.v1` document. Angle
brackets are placeholders, not literal values. Optional fields are omitted,
not emitted as `null`, unless the schema explicitly says otherwise.

```json
{
  "format": "patchhive.evidence-pack.v1",
  "schemaVersion": 1,
  "canonicalization": "patchhive-canonical-json-v1",
  "hashAlgorithm": "SHA-256",
  "authenticity": "unverified",
  "generatedAt": "2026-08-21T00:00:00.000Z",
  "workspaceSchemaVersion": 8,
  "mission": {
    "id": "mission-20260821-evidence-pack",
    "templateId": "pr-rescue",
    "status": "ready",
    "title": "Verify local import boundary",
    "source": {
      "kind": "github-url",
      "url": "https://github.com/example/project/pull/42",
      "parsedRepo": "example/project",
      "parsedNumber": "42"
    },
    "repo": "example/project",
    "branch": "feat/evidence-pack",
    "goal": "Confirm the local import workflow.",
    "constraints": ["No network access", "Review before sharing"],
    "activeStageId": "stage-review",
    "stages": [
      {
        "id": "stage-review",
        "name": "Review",
        "summary": "Check the mission evidence.",
        "nextAction": "Confirm the maintainer gate.",
        "lanes": [
          {
            "id": "lane-maintainer",
            "name": "Maintainer",
            "role": "Reviews local evidence",
            "status": "ready",
            "confidence": 0.9,
            "findings": [],
            "assignedEvidenceIds": ["evidence-1"],
            "outputDraft": ""
          }
        ]
      }
    ],
    "evidence": [
      {
        "id": "evidence-1",
        "kind": "file",
        "title": "Unit test result",
        "detail": "The local validation passed.",
        "url": "https://github.com/example/project/actions",
        "filePath": "src/evidencePack.ts:42",
        "stageId": "stage-review",
        "agentId": "lane-maintainer",
        "severity": "low",
        "triageStatus": "resolved",
        "resolutionNote": "Covered by the local test.",
        "provenance": {
          "importer": "agent-hygiene",
          "format": "json",
          "sourceName": "scan.json",
          "toolName": "agent-hygiene",
          "producerStatus": "declared",
          "producerVersion": "0.5.0",
          "sourceRevision": "0123456789abcdef",
          "scanComplete": true,
          "scopeId": "scope-example",
          "ruleId": "AH001",
          "fingerprint": "fingerprint-example",
          "findingKey": "finding-example",
          "importedAt": "2026-08-21T00:00:00.000Z"
        },
        "createdAt": "2026-08-21T00:00:00.000Z",
        "updatedAt": "2026-08-21T00:00:00.000Z"
      }
    ],
    "approvals": [
      {
        "id": "approval-scope",
        "label": "Patch scope approved",
        "riskLevel": "low",
        "requiredBefore": "Review",
        "approved": true,
        "approvedAt": "2026-08-21T00:00:00.000Z"
      }
    ],
    "outputs": {
      "summary": "Local evidence reviewed.",
      "patchPlan": "Keep the import boundary local.",
      "testPlan": "Run the focused browser flow.",
      "risks": "A self-reported digest does not prove origin.",
      "maintainerComment": "Review the preview before import.",
      "fieldSources": {
        "summary": ["evidence-1"]
      },
      "ready": true
    },
    "createdAt": "2026-08-21T00:00:00.000Z",
    "updatedAt": "2026-08-21T00:00:00.000Z"
  },
  "redactions": [],
  "digest": "<64 lowercase hexadecimal characters>"
}
```

The example is intentionally not a complete workspace. Templates, workspace
settings, `activeMissionId`, and other missions do not cross the pack boundary.
The top-level envelope has exactly the fields shown above. The canonical digest
input is the entire envelope with only `digest` removed; every other top-level
field, the cleaned `mission`, and the sorted `redactions` list are covered. The
optional trusted digest entered in the verification UI is comparison input, not
pack content.

Each `redactions` entry is `{ "pointer": "<JSON Pointer>", "category":
"<local category>", "action": "omit" | "redact" }`, sorted by pointer,
category, and action. The list records the deterministic cleanup that produced
the `mission`; it is itself covered by the digest. Omission entries are an
unauthenticated exporter claim about source fields that are no longer present,
not proof that the source value existed or was removed by a particular author.

## Redaction and omission

Export and verification apply the same local rules. Sensitive values in
supported user-authored scalar fields are replaced by deterministic redaction
markers. Path-bearing fields are reduced to safe relative paths; absolute POSIX
paths, `~` paths, Windows drive paths, decoded absolute paths, and traversal
segments are not carried into the pack. Local paths split across space-delimited
tokens and URLs with sensitive query or fragment names in retained text are
redacted as a unit. Once an absolute local path begins in free text, cleanup is
deliberately conservative and can redact through the next sentence boundary or
line break rather than risk retaining a space-separated path suffix. A
redaction or path-cleanup failure is a verification failure, not a reason to
import the original value.

The following fields are deliberately omitted even when present in the source
workspace:

- `mission.source.rawText`;
- `mission.evidence[].sourceText`;
- `mission.evidence[].provenance.scanRoot`;
- `mission.stages[].lanes[].findings` source content (the pack carries `[]`)
  and `mission.stages[].lanes[].outputDraft` source content (the pack carries
  `""`), plus other agent draft text;
- the complete workspace, templates, settings, and unrelated missions.

Omission is stronger than masking: an omitted value cannot be recovered from
the pack. Redaction is not encryption and does not guarantee that a user-authored
title, goal, detail, or comment contains no sensitive meaning. Review the
verification preview before sharing or importing.

## Canonicalization and digest coverage

The digest is computed with `crypto.subtle.digest('SHA-256', ...)` over the UTF-8
bytes of the canonical envelope with `digest` removed. Canonicalization is
deterministic:

1. Build the allowed top-level envelope and cleaned `mission` object.
2. Omit absent optional values rather than adding `null` or `undefined`.
3. Sort object keys lexicographically at every depth.
4. Preserve array order; arrays are data, not sets.
5. Serialize with compact JSON (no insignificant whitespace) and encode as
   UTF-8.
6. Render the digest as lowercase hexadecimal.

Only the `digest` value and any user-entered trusted digest are outside digest
coverage. Reordering object keys or changing file whitespace therefore
does not change the digest; changing any other covered value, array order,
omission, or redaction marker does. A changed envelope with an old digest must
fail closed.

This self-check proves only that the bytes presented to the verifier match the
self-reported digest. It does not prove who produced them. `authenticity` is
always `unverified`; an independent, separately obtained digest can match the
computed value and increase confidence in the bytes, but it does not become a
signature or authenticity proof.

## Import sequence and atomicity

The user-visible import sequence is:

1. Read the selected file locally and enforce size and JSON bounds.
2. Validate the pack format, one-mission shape, omission rules, safe paths, and
   workspace-compatible fields.
3. Clean the mission, canonicalize the envelope with `digest` removed, and
   compute the Web Crypto digest.
4. Compare the self-reported digest and, if supplied, the independent trusted
   digest.
5. Show the verification preview, including **Integrity self-check passed** and
   **Authenticity remains unverified**. A trusted digest comparison can only
   increase confidence; it never changes the authenticity value.
6. On **Import verified mission**, read the current browser-storage expectation
   and derive a candidate workspace: same id replaces, different id adds.
7. Save the candidate against that expectation. Only after a successful save
   does the application dispatch the candidate in memory.

This is CAS-like protection, not a strong Web Storage CAS primitive. Another
writer can still race after the comparison and before `setItem`. A conflict,
quota error, unavailable storage, validation failure, redaction failure, or
digest mismatch leaves the old in-memory workspace and the old stored string
unchanged. No import button is offered for a failed verification.

## Failure modes

| Failure | Preview/import behavior | Workspace effect |
| --- | --- | --- |
| wrong format, oversized, malformed, or too-deep JSON | show a validation error; no import action | unchanged |
| raw/omitted field, unsafe path, or sensitive-value cleanup failure | reject the pack | unchanged |
| self digest mismatch or invalid SHA-256 text | show failed integrity check; hide import | unchanged |
| trusted digest mismatch | reject verification and hide import; the user may choose another digest or file | unchanged |
| same mission id | replace only after confirmation and successful save | candidate becomes current |
| different mission id | add only after confirmation and successful save | candidate becomes current |
| storage conflict, quota, or unavailable storage | show recovery/error state; do not dispatch | unchanged |

The self digest must never be described as a signature. The pack does not close
issue #13, establish authenticity, or supply external maintainer-trial
evidence. The external trial remains `N=0 / not evaluated`.

## Local re-verification commands

Run the checks available in the repository from its root:

```bash
npm ci
npm run lint
npm test
npm run build
npx playwright test e2e/patchhive.spec.ts --grep "Evidence Pack" --project=chromium
npx playwright test e2e/patchhive.spec.ts --grep "Evidence Pack" --project=webkit
```

The complete release-gate command remains `npm run check`; the Evidence Pack
does not add the scanner benchmark to CI and this document makes no new
performance claim.

## Evidence-grade release gate

Exact commit-scoped test results, CI run URLs, release checksums, and deployed
SHA evidence belong in the GitHub pull request and release rather than this
versioned format contract. A release requires the unit, Chromium, WebKit,
build, Pages-path, and dependency-audit gates above to pass for the released
commit. The external maintainer trial remains `N=0 / not evaluated`, and this
feature does not claim to close issue #13.
