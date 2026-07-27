# agent-hygiene v0.5.0 interoperability fixtures

These synthetic files are copied byte-for-byte from the
`agent-hygiene/examples/patchhive` v0.5.0 source fixture set:

| File | SHA-256 |
| --- | --- |
| `findings.json` | `3b3addc2a8c9d50864554ffac6a99ba463a266448429134c6a2871e90251abe6` |
| `clean-rerun.json` | `7471bcca1753b8d49068f037bc6797fe75a6a530ef29515b81dc28619548bf66` |

The first report contains one high-severity finding. The second is a complete
clean rerun with the same opaque scope and a different declared revision.
PatchHive must keep the first finding open until the second report is imported.

This pair is compatibility evidence only: external maintainer trial `N=0`, no
consenting repository, and no independent validation.
