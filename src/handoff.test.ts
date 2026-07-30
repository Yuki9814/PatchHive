import { describe, expect, it } from 'vitest'
import {
  buildHandoffMarkdown,
  getHandoffBlockers,
  getNextStageGateBlocker,
  getStageGateBlocker,
  isHandoffReady,
} from './handoff'
import { createMissionFromInput } from './templates'

function readyMission() {
  const mission = createMissionFromInput({
    templateId: 'pr-rescue',
    title: 'Reviewable patch',
    sourceKind: 'github-url',
    sourceText: 'https://github.com/owner/repo/pull/42',
    goal: 'Ship a minimal patch.',
    branch: 'main',
    constraints: 'Keep the diff tight',
  })

  return {
    ...mission,
    approvals: mission.approvals.map((approval) => ({
      ...approval,
      approved: true,
      approvedAt: '2026-06-07T00:00:00.000Z',
    })),
    outputs: {
      ...mission.outputs,
      fieldSources: {
        summary: [mission.evidence[0].id],
      },
    },
  }
}

describe('handoff', () => {
  it('reports blockers for pending approvals and empty required draft fields', () => {
    const mission = {
      ...readyMission(),
      approvals: readyMission().approvals.map((approval) =>
        approval.id === 'external-handoff' ? { ...approval, approved: false, approvedAt: undefined } : approval,
      ),
      outputs: {
        ...readyMission().outputs,
        risks: '',
      },
    }

    expect(getHandoffBlockers(mission)).toEqual([
      'Maintainer-facing message approved before Handoff export',
      'Risks is required',
    ])
    expect(isHandoffReady(mission)).toBe(false)
  })

  it('uses the same approval blocker text for stage and handoff gates', () => {
    const mission = readyMission()
    const patchPlanStage = mission.stages.find((stage) => stage.id === 'patch-plan')
    const gatedMission = {
      ...mission,
      approvals: mission.approvals.map((approval) =>
        approval.id === 'patch-scope' ? { ...approval, approved: false, approvedAt: undefined } : approval,
      ),
    }

    expect(getNextStageGateBlocker(gatedMission)).toBe('Patch scope approved before Patch Plan')
    expect(getStageGateBlocker(gatedMission, patchPlanStage?.id ?? '')).toBe(
      getHandoffBlockers(gatedMission)[0],
    )
  })

  it('exports edited summary, risks, evidence, and approvals', () => {
    const mission = readyMission()
    const markdown = buildHandoffMarkdown({
      ...mission,
      outputs: {
        ...mission.outputs,
        summary: 'Edited maintainer summary.',
        risks: 'Regression risk is low after parser coverage.',
      },
    })

    expect(isHandoffReady(mission)).toBe(true)
    expect(markdown).toContain('Edited maintainer summary.')
    expect(markdown).toContain('Regression risk is low after parser coverage.')
    expect(markdown).toContain('[link] Source GitHub thread')
    expect(markdown).toContain('## Handoff Evidence Sources')
    expect(markdown).toContain('Maintainer-facing message approved')
  })

  it('builds concise GitHub Issue and Pull Request templates without internal workflow detail', () => {
    const mission = {
      ...readyMission(),
      evidence: [
        ...readyMission().evidence,
        {
          ...readyMission().evidence[0],
          id: 'unmapped-internal-evidence',
          title: 'Unmapped internal evidence',
        },
      ],
    }
    const issueMarkdown = buildHandoffMarkdown(mission, 'github-issue')
    const pullRequestMarkdown = buildHandoffMarkdown(
      mission,
      'github-pull-request',
    )

    expect(issueMarkdown).toContain('## Proposed Work')
    expect(issueMarkdown).toContain('## Acceptance and Verification')
    expect(issueMarkdown).toContain('## Accepted Scanner Risks')
    expect(pullRequestMarkdown).toContain('## Changes')
    expect(pullRequestMarkdown).toContain('## Verification')
    expect(pullRequestMarkdown).toContain('## Risk and Rollback')
    expect(issueMarkdown).not.toContain('## Workflow Stages')
    expect(pullRequestMarkdown).not.toContain('## Agent Outputs')
    expect(pullRequestMarkdown).not.toContain('## Approvals')
    expect(pullRequestMarkdown).not.toContain('Unmapped internal evidence')
  })

  it('blocks export until evidence is mapped into the handoff', () => {
    const mission = {
      ...readyMission(),
      outputs: {
        ...readyMission().outputs,
        fieldSources: {},
      },
    }

    expect(getHandoffBlockers(mission)).toContain('At least one handoff field needs evidence source coverage')
    expect(isHandoffReady(mission)).toBe(false)
  })

  it('keeps incomplete and open high-severity scanner imports as explicit handoff blockers', () => {
    const mission = readyMission()
    const importedAt = '2026-07-26T00:00:00.000Z'
    const scannerEvidence = {
      id: 'scanner-evidence',
      kind: 'file' as const,
      title: 'AH003 · Hard-coded secret',
      detail:
        '<img src=x> ![tracking](https://example.com/pixel) @openai/security #123 needs review.',
      filePath: 'AGENTS.md:4',
      severity: 'critical' as const,
      triageStatus: 'open' as const,
      provenance: {
        importer: 'agent-hygiene' as const,
        format: 'json' as const,
        sourceName: 'scan.json',
        toolName: 'agent-hygiene' as const,
        scanComplete: false,
        importedAt,
        ruleId: 'AH003',
      },
      createdAt: importedAt,
      updatedAt: importedAt,
    }
    const scanSummaryEvidence = {
      ...scannerEvidence,
      id: 'scanner-summary',
      kind: 'decision' as const,
      title: 'agent-hygiene scan summary',
      detail: 'agent-hygiene JSON scan · incomplete',
      severity: 'high' as const,
      provenance: {
        ...scannerEvidence.provenance,
        ruleId: 'scan/summary',
      },
    }
    const blockers = getHandoffBlockers({
      ...mission,
      evidence: [scanSummaryEvidence, scannerEvidence, ...mission.evidence],
    })

    expect(blockers).toContain(
      'Imported scan scan.json is incomplete; import a complete rerun before handoff',
    )
    expect(blockers).toContain('1 high-severity imported finding(s) still need triage')
    const markdown = buildHandoffMarkdown({
      ...mission,
      evidence: [scanSummaryEvidence, scannerEvidence, ...mission.evidence],
    })

    expect(markdown).toContain('\\<img src=x\\> \\!\\[tracking\\]')
    expect(markdown).toContain('@\u200Bopenai/security')
    expect(markdown).toContain('#\u200B123')
    expect(markdown).toContain('https:\u200B//example.\u200Bcom/pixel')
    expect(markdown).not.toContain('@openai/security')
    expect(markdown).not.toContain('https://example.com/pixel')
  })

  it('fails closed for accepted scanner risks without a note and safely exports a note', () => {
    const mission = readyMission()
    const importedAt = '2026-07-26T00:00:00.000Z'
    const acceptedRisk = {
      id: 'accepted-scanner-risk',
      kind: 'file' as const,
      title: 'AH006 · Shell command risk',
      detail: 'A generated workflow command needs review.',
      filePath: '.github/workflows/scan.yml:12',
      severity: 'high' as const,
      triageStatus: 'accepted' as const,
      provenance: {
        importer: 'agent-hygiene' as const,
        format: 'sarif' as const,
        sourceName: 'scan.sarif',
        toolName: 'agent-hygiene' as const,
        producerStatus: 'declared' as const,
        producerVersion: '0.3.0',
        scanComplete: true,
        importedAt,
        scopeId: 'scope-accepted-risk',
        ruleId: 'AH006',
        fingerprint: '12121212121212121212',
        findingKey: 'finding-accepted-risk',
      },
      createdAt: importedAt,
      updatedAt: importedAt,
    }
    const missingNoteMission = {
      ...mission,
      evidence: [acceptedRisk, ...mission.evidence],
    }

    expect(getHandoffBlockers(missingNoteMission)).toContain(
      '1 accepted scanner risk(s) need a non-empty resolution note',
    )
    expect(isHandoffReady(missingNoteMission)).toBe(false)

    const documentedMission = {
      ...missingNoteMission,
      evidence: [
        {
          ...acceptedRisk,
          resolutionNote:
            'Owner @maintainer accepts #42 while https://example.com stays local.',
        },
        ...mission.evidence,
      ],
    }
    const markdown = buildHandoffMarkdown(documentedMission)

    expect(getHandoffBlockers(documentedMission)).not.toContain(
      '1 accepted scanner risk(s) need a non-empty resolution note',
    )
    expect(markdown).toContain('## Accepted Scanner Risks')
    expect(markdown).toContain('@\u200Bmaintainer')
    expect(markdown).toContain('#\u200B42')
    expect(markdown).toContain('https:\u200B//example.\u200Bcom')
    expect(markdown).not.toContain('@maintainer')
    expect(markdown).not.toContain('https://example.com')
  })

  it('accepts resolved scanner findings only with complete-rerun provenance', () => {
    const mission = readyMission()
    const importedAt = '2026-07-27T00:00:00.000Z'
    const resolvedRisk = {
      id: 'resolved-scanner-risk',
      kind: 'file' as const,
      title: 'AH002 · Prompt override',
      detail: 'The unsafe instruction no longer appears.',
      filePath: 'AGENTS.md:5',
      severity: 'high' as const,
      triageStatus: 'resolved' as const,
      provenance: {
        importer: 'agent-hygiene' as const,
        format: 'json' as const,
        sourceName: 'findings.json',
        toolName: 'agent-hygiene' as const,
        producerStatus: 'declared' as const,
        producerVersion: '0.5.0',
        sourceRevision: '1111111111111111111111111111111111111111',
        scanComplete: true,
        importedAt,
        scopeId: 'scope-rerun',
        ruleId: 'AH002',
        fingerprint: '12121212121212121212',
        findingKey: 'finding-resolved-risk',
      },
      createdAt: importedAt,
      updatedAt: importedAt,
    }
    const forgedMission = {
      ...mission,
      evidence: [resolvedRisk, ...mission.evidence],
    }

    expect(getHandoffBlockers(forgedMission)).toContain(
      '1 resolved scanner finding(s) lack complete same-scope rerun evidence',
    )

    const evidencedMission = {
      ...forgedMission,
      evidence: [
        {
          ...resolvedRisk,
          provenance: {
            ...resolvedRisk.provenance,
            resolution: {
              method: 'complete-rerun' as const,
              format: 'json' as const,
              sourceName: 'clean-rerun.json',
              producerStatus: 'declared' as const,
              producerVersion: '0.5.0',
              sourceRevision: '2222222222222222222222222222222222222222',
              importedAt,
            },
          },
        },
        ...mission.evidence,
      ],
    }
    const markdown = buildHandoffMarkdown(evidencedMission)

    expect(getHandoffBlockers(evidencedMission)).not.toContain(
      '1 resolved scanner finding(s) lack complete same-scope rerun evidence',
    )
    expect(markdown).toContain('## Resolved Scanner Findings')
    expect(markdown).toContain(
      'complete same-scope rerun clean-rerun.json at revision 2222222222222222222222222222222222222222',
    )
  })
})
