# Roadmap

PatchHive is developed in evidence-backed increments. Dates are intentionally
not promised before the preceding acceptance gate is met.

## v0.2 — trusted local scanner intake

- [x] agent-hygiene native JSON and SARIF preview
- [x] scoped provenance, collision-safe identity, severity, and triage states
- [x] workspace schema v6 migration
- [x] incomplete-scan and high-severity handoff blockers
- [x] artifact-based GitHub Pages deployment
- [x] full dependency audit and browser workflow coverage

## v0.3 — maintainer-scale triage

- [x] add deterministic sorting, severity/triage filters, and 25-item pagination
- [x] require a non-empty resolution note for accepted scanner risks
- [x] require a complete same-scope rerun before scanner risks can be resolved
- [x] export a scanner-triage appendix with accepted-risk rationale
- [x] publish documented performance measurements at the 250-finding limit
- [x] provide a consented, minimum-disclosure local trial report
- [ ] test two additional evergreen browsers
- [ ] complete an external maintainer workflow trial (`N=0`, not accepted)

Acceptance gate: zero high-severity dependency advisories, successful v1-v6 to
v7 migration fixtures, measured import/render behavior at the supported limit,
and no external usability claim before real trial evidence exists.

## v0.4 — contribution handoff quality

- [x] add portable agent-hygiene Action JSON intake and frozen cross-project fixtures
- [x] carry declared source revision and complete-rerun provenance into handoff
- [x] fail visibly and preserve recovery options when browser storage is
  corrupt, newer than supported, full, or unavailable
- [x] detect cross-tab storage conflicts before normal write or discard and
  preserve the current in-memory workspace for backup
- [x] add opt-in redaction checks before Markdown copy/download
- [x] add shareable, non-secret handoff templates for issue and pull-request use
- [ ] add import fixture contributions with a documented review rubric

Acceptance gate: contributor documentation, security review, and evidence that
the new output reduces manual cleanup without expanding the network boundary.
Interoperability is locally verified; the external maintainer trial remains
`N=0 / not evaluated`.

## v0.7 — local Evidence Pack

- [x] export exactly one mission as a minimum-disclosure Evidence Pack
- [x] apply mandatory field-level local sensitive-value and path cleanup
- [x] omit raw source text, evidence source text, scanner roots, and agent drafts
- [x] canonicalize the envelope deterministically and compute a Web Crypto SHA-256
- [x] preview integrity verification and keep authenticity explicitly unverified
- [x] optionally compare a digest obtained through an independent trusted channel
- [x] import only after verification, saving before in-memory dispatch
- [x] replace a same-id mission or add a different-id mission atomically from the
  user's point of view, while preserving the workspace on failure
- [ ] complete an external maintainer workflow trial (`N=0`, not evaluated)

Acceptance gate: local schema, redaction, canonicalization, digest, and
replace/add failure paths are covered by unit and browser checks. This does not
close issue #13 or establish external adoption, authenticity, or performance
evidence; those remain separate follow-up work.

## Out of scope for the preview

- autonomous code modification
- credentials or hosted project storage
- automatic maintainer communication
- claims of adoption or ecosystem impact without public evidence
