import { describe, expect, it } from 'vitest'
import { createMissionFromInput, parseGithubSource } from './templates'

describe('templates', () => {
  it('parses GitHub issue and PR URLs locally', () => {
    expect(parseGithubSource('https://github.com/owner/repo/pull/42')).toEqual({
      parsedRepo: 'owner/repo',
      parsedNumber: '42',
    })
    expect(parseGithubSource('https://github.com/owner/repo/issues/7')).toEqual({
      parsedRepo: 'owner/repo',
      parsedNumber: '7',
    })
    expect(parseGithubSource('github.com/owner.name/repo-name/pulls/91?plain=1#discussion')).toEqual({
      parsedRepo: 'owner.name/repo-name',
      parsedNumber: '91',
    })
  })

  it('creates a mission with parsed repo, source evidence, and export gates', () => {
    const mission = createMissionFromInput({
      templateId: 'pr-rescue',
      title: 'Tighten parser guard',
      sourceKind: 'github-url',
      sourceText: 'https://github.com/owner/repo/pull/42',
      goal: 'Reduce review burden.',
      branch: 'fix/parser-guard',
      constraints: 'Keep diff minimal\nAdd regression coverage',
    })

    expect(mission.repo).toBe('owner/repo')
    expect(mission.evidence).toHaveLength(2)
    expect(mission.approvals.map((approval) => approval.requiredBefore)).toContain('Handoff export')
  })

  it('labels non-GitHub source evidence by captured source type', () => {
    const mission = createMissionFromInput({
      templateId: 'issue-intake',
      title: 'Log intake',
      sourceKind: 'log-paste',
      sourceText: 'npm test failed with parser timeout',
      goal: 'Capture repro notes.',
      branch: 'main',
      constraints: 'Keep notes traceable',
    })

    expect(mission.evidence[0]).toMatchObject({
      kind: 'log',
      title: 'Source Pasted log',
    })
    expect(mission.evidence[0].detail).toContain('Pasted log captured')
  })
})
