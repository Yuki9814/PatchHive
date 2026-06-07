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
})
