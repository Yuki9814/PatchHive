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
})
