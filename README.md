# PatchHive

PatchHive is a browser-only local workbench for open-source maintainers. It turns a GitHub issue or PR, pasted diff, log, or manual brief into a structured mission with specialized agent lanes, evidence, approval gates, and a maintainer handoff draft.

The v1 product is intentionally local-first:

- no backend
- no OAuth
- no model execution
- no external posting

Instead, PatchHive focuses on the core contribution workflow: capture context, assign structured agent work, keep evidence traceable, require human approval before risky handoff, and export a concise Markdown package.

## What Works

- Create missions from three templates: `PR Rescue`, `Issue Intake`, and `Release Brief`
- Paste a GitHub issue or PR URL, diff, log, or manual source brief
- Persist missions, stages, evidence, approvals, and handoff drafts in browser storage
- Edit structured lanes for Planner, Repo Reader, Review Agent, Patch Agent, and Test Agent
- Attach evidence as file, log, decision, link, or diff records
- Approve or withdraw human gates with timestamps
- Block handoff export until required approvals are complete
- Copy or download Markdown handoff output
- Reset to sample data

## Run Locally

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
```

Lint the project:

```bash
npm run lint
```

## Typical Workflow

1. Click `New mission`.
2. Pick a template.
3. Paste a GitHub URL, diff, log, or manual brief.
4. Confirm the goal and guardrails.
5. Add findings to each agent lane.
6. Attach evidence to the mission.
7. Approve the required gates.
8. Copy or download the Markdown handoff.

## V1 Limits

- GitHub URLs are parsed locally; GitHub API import is not implemented.
- Agent lanes are structured workflow surfaces, not live model agents.
- Storage is local to the browser.
- Handoff export is Markdown only.
- External maintainer communication always remains a manual human action.

## Product Direction

PatchHive is designed around five principles:

- specialization over generic agent chatter
- evidence before action
- human approval for meaningful risk
- maintainers need concise handoffs, not noisy transcripts
- workflows should feel useful on desktop and remain usable on mobile
