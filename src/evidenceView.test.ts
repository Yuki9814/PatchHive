import { describe, expect, it } from 'vitest'
import { filterAndSortEvidence } from './evidenceView'
import type { EvidenceItem } from './types'

function evidence(
  id: string,
  overrides: Partial<EvidenceItem> = {},
): EvidenceItem {
  return {
    id,
    kind: 'file',
    title: id,
    detail: `${id} detail`,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
  }
}

describe('evidence view', () => {
  it('sorts deterministically by severity, triage, path, and title', () => {
    const sorted = filterAndSortEvidence(
      [
        evidence('low', { severity: 'low', triageStatus: 'open', filePath: 'z.ts:1' }),
        evidence('high-b', {
          severity: 'high',
          triageStatus: 'open',
          filePath: 'b.ts:1',
        }),
        evidence('critical', {
          severity: 'critical',
          triageStatus: 'accepted',
          filePath: 'a.ts:1',
        }),
        evidence('high-a', {
          severity: 'high',
          triageStatus: 'open',
          filePath: 'a.ts:1',
        }),
      ],
      {
        kind: 'all',
        stageId: 'all',
        agentId: 'all',
        severity: 'all',
        triage: 'all',
      },
    )

    expect(sorted.map((item) => item.id)).toEqual([
      'critical',
      'high-a',
      'high-b',
      'low',
    ])
  })

  it('combines severity, triage, kind, stage, and agent filters', () => {
    const matching = evidence('matching', {
      kind: 'file',
      severity: 'high',
      triageStatus: 'accepted',
      stageId: 'triage',
      agentId: 'review-agent',
    })
    const filtered = filterAndSortEvidence(
      [
        matching,
        evidence('wrong-severity', {
          severity: 'low',
          triageStatus: 'accepted',
          stageId: 'triage',
          agentId: 'review-agent',
        }),
        evidence('manual', { kind: 'decision', stageId: 'triage' }),
      ],
      {
        kind: 'file',
        stageId: 'triage',
        agentId: 'review-agent',
        severity: 'high',
        triage: 'accepted',
      },
    )

    expect(filtered).toEqual([matching])
  })
})
