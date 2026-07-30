# Minimum-disclosure maintainer trial

PatchHive needs independent workflow evidence before it can make adoption or
usability claims. The **Maintainer trial** panel lowers the cost of collecting
that evidence without adding telemetry, accounts, automatic posting, or a
backend.

The report is optional and local. PatchHive does not persist the answers or
send them anywhere. A participant must complete the structured fields, affirm
consent, generate the report, review the exact JSON, and then deliberately copy
or download it.

## Suggested trial protocol

1. Recruit a consenting maintainer who is not evaluating their own PatchHive
   work.
2. Ask them to use a public repository or a task they are authorized to review.
   Do not collect proprietary source or credentials.
3. Let the participant complete or stop the PatchHive workflow without coaching
   them through individual controls.
4. In **Maintainer trial**, record the outcome, elapsed whole minutes, workflow
   clarity from 1 to 5, reuse intent, and the primary friction area.
5. Review the generated JSON. It must not contain manually added project
   context because the report has no free-text field.
6. If the participant still consents, manually attach the downloaded JSON or
   paste the copied JSON into the agreed feedback channel.
7. Record qualitative comments separately, with separate consent and the same
   prohibition on secrets or proprietary context.

## Report contract

`patchhive.maintainer-trial.v1` contains:

- the UTC calendar date of generation
- an explicit participant-consent marker
- the observed handoff-ready boolean and blocker count
- structured outcome, elapsed time, clarity, reuse intent, and primary friction
- explicit statements that PatchHive did not store or send the answers and did
  not include mission, repository, or browser identity

It does not contain mission IDs or titles, repository names or URLs, branches,
source text, evidence, findings, handoff Markdown, free-form comments, browser
user agents, IP addresses, or participant identifiers.

The report lives only in the current React component state until it is copied,
downloaded, cleared, the mission changes, or the page reloads. It does not
change workspace schema v8 or the `patchhive.workspace.v1` payload.

## Interpreting collected reports

Count only consented, independently supplied reports. Deduplicate obvious
reposts before calculating completion rate. Report the sample size, recruitment
method, task limits, median elapsed time, handoff-ready rate, clarity
distribution, reuse-intent distribution, and primary-friction counts.

These artifacts are self-reported and editable after download. They do not
prove participant identity, independence, task representativeness, or causal
product impact. Do not describe generated internal reports as external trials,
and do not make adoption or ecosystem claims from a small convenience sample.

Current external maintainer trial status remains **N=0 / not evaluated** until
real, consenting external maintainers return reports.
