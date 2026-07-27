import { describe, expect, it } from 'vitest'
import cleanRerunFixture from '../fixtures/agent-hygiene/v0.5.0/clean-rerun.json?raw'
import findingFixture from '../fixtures/agent-hygiene/v0.5.0/findings.json?raw'
import { parseAgentHygieneImport } from './agentHygieneImport'
import { buildHandoffMarkdown, getHandoffBlockers } from './handoff'
import { createDefaultWorkspace } from './storage'
import { workspaceReducer } from './workspaceReducer'

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

describe('agent-hygiene v0.5.0 interoperability', () => {
  it('keeps a finding open until a complete same-scope clean rerun resolves it', () => {
    const findingScan = parseAgentHygieneImport(findingFixture, 'findings.json')
    const cleanRerun = parseAgentHygieneImport(cleanRerunFixture, 'clean-rerun.json')

    expect(findingScan.scopeId).toBe(cleanRerun.scopeId)
    expect(findingScan.sourceRevision).toBe('1111111111111111111111111111111111111111')
    expect(cleanRerun.sourceRevision).toBe('2222222222222222222222222222222222222222')
    expect(findingScan.findings).toHaveLength(1)
    expect(cleanRerun.findings).toHaveLength(0)

    const workspace = createDefaultWorkspace()
    const mission = workspace.missions[0]
    const stageId = mission.activeStageId
    const imported = workspaceReducer(workspace, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId,
      scan: findingScan,
    })
    const openFinding = imported.missions[0].evidence.find(
      (evidence) => evidence.provenance?.ruleId === 'AH002',
    )

    expect(openFinding?.triageStatus).toBe('open')

    const manualResolutionAttempt = workspaceReducer(imported, {
      type: 'set-scanner-triage',
      missionId: mission.id,
      evidenceId: openFinding?.id ?? '',
      triageStatus: 'resolved',
    })
    expect(
      manualResolutionAttempt.missions[0].evidence.find(
        (evidence) => evidence.id === openFinding?.id,
      )?.triageStatus,
    ).toBe('open')

    const rerun = workspaceReducer(manualResolutionAttempt, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId,
      scan: cleanRerun,
    })
    const resolvedFinding = rerun.missions[0].evidence.find(
      (evidence) => evidence.id === openFinding?.id,
    )

    expect(resolvedFinding?.triageStatus).toBe('resolved')
    expect(resolvedFinding?.provenance).toMatchObject({
      sourceName: 'findings.json',
      sourceRevision: '1111111111111111111111111111111111111111',
      resolution: {
        method: 'complete-rerun',
        sourceName: 'clean-rerun.json',
        sourceRevision: '2222222222222222222222222222222222222222',
      },
    })
    expect(getHandoffBlockers(rerun.missions[0])).not.toContain(
      '1 high-severity imported finding(s) still need triage',
    )
    expect(buildHandoffMarkdown(rerun.missions[0])).toContain(
      'complete same-scope rerun clean-rerun.json at revision 2222222222222222222222222222222222222222',
    )

    const deletionAttempt = workspaceReducer(rerun, {
      type: 'delete-evidence',
      missionId: mission.id,
      evidenceId: resolvedFinding?.id ?? '',
    })
    expect(
      deletionAttempt.missions[0].evidence.some(
        (evidence) => evidence.id === resolvedFinding?.id,
      ),
    ).toBe(true)
  })

  it('pins the byte-for-byte public fixture pair', async () => {
    expect(await sha256(findingFixture)).toBe(
      '3b3addc2a8c9d50864554ffac6a99ba463a266448429134c6a2871e90251abe6',
    )
    expect(await sha256(cleanRerunFixture)).toBe(
      '7471bcca1753b8d49068f037bc6797fe75a6a530ef29515b81dc28619548bf66',
    )
  })
})
