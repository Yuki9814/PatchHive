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
- [ ] require follow-up evidence for manually resolved scanner risks
- [x] export a scanner-triage appendix with accepted-risk rationale
- [x] publish documented performance measurements at the 250-finding limit
- [ ] test two additional evergreen browsers
- [ ] complete an external maintainer workflow trial (`N=0`, not accepted)

Acceptance gate: zero high-severity dependency advisories, successful v1-v6 to
v7 migration fixtures, measured import/render behavior at the supported limit,
and no external usability claim before real trial evidence exists.

## v0.4 — contribution handoff quality

- [ ] add opt-in redaction checks before Markdown copy/download
- [ ] add shareable, non-secret handoff templates for issue and pull-request use
- [ ] add import fixture contributions with a documented review rubric

Acceptance gate: contributor documentation, security review, and evidence that
the new output reduces manual cleanup without expanding the network boundary.

## Out of scope for the preview

- autonomous code modification
- credentials or hosted project storage
- automatic maintainer communication
- claims of adoption or ecosystem impact without public evidence
