import { describe, expect, it } from 'vitest'
import {
  MAINTAINER_TRIAL_REPORT_FORMAT,
  buildMaintainerTrialReport,
  serializeMaintainerTrialReport,
  type MaintainerTrialAnswers,
} from './trialReport'

const validAnswers: MaintainerTrialAnswers = {
  outcome: 'partially-completed',
  elapsedMinutes: 37,
  clarityRating: 4,
  reuseIntent: 'maybe',
  primaryFriction: 'evidence-triage',
}

describe('maintainer trial report', () => {
  it('builds a consented minimum-disclosure report from structured answers', () => {
    const report = buildMaintainerTrialReport(
      validAnswers,
      {
        handoffReady: false,
        handoffBlockerCount: 2,
      },
      new Date('2026-07-30T23:59:59.000Z'),
    )

    expect(report).toEqual({
      format: MAINTAINER_TRIAL_REPORT_FORMAT,
      generatedOn: '2026-07-30',
      participantConsent: 'affirmed',
      privacy: {
        storedByPatchHive: false,
        sentByPatchHive: false,
        includesMissionContent: false,
        includesRepositoryIdentity: false,
        includesBrowserIdentity: false,
      },
      workflow: {
        handoffReady: false,
        handoffBlockerCount: 2,
      },
      answers: validAnswers,
    })

    const serialized = serializeMaintainerTrialReport(report)
    expect(serialized.endsWith('\n')).toBe(true)
    expect(JSON.parse(serialized)).toEqual(report)
    expect(serialized).not.toContain('missionId')
    expect(serialized).not.toContain('repository')
    expect(serialized).not.toContain('userAgent')
  })

  it.each([
    {
      label: 'zero elapsed time',
      answers: { ...validAnswers, elapsedMinutes: 0 },
    },
    {
      label: 'fractional elapsed time',
      answers: { ...validAnswers, elapsedMinutes: 1.5 },
    },
    {
      label: 'unsupported clarity rating',
      answers: { ...validAnswers, clarityRating: 6 },
    },
    {
      label: 'unsupported friction area',
      answers: { ...validAnswers, primaryFriction: 'repository-details' },
    },
  ])('rejects $label', ({ answers }) => {
    expect(() =>
      buildMaintainerTrialReport(
        answers as MaintainerTrialAnswers,
        {
          handoffReady: true,
          handoffBlockerCount: 0,
        },
        new Date('2026-07-30T00:00:00.000Z'),
      ),
    ).toThrow()
  })

  it('rejects invalid derived workflow context and dates', () => {
    expect(() =>
      buildMaintainerTrialReport(
        validAnswers,
        {
          handoffReady: false,
          handoffBlockerCount: -1,
        },
        new Date('2026-07-30T00:00:00.000Z'),
      ),
    ).toThrow(/blocker count/i)

    expect(() =>
      buildMaintainerTrialReport(
        validAnswers,
        {
          handoffReady: true,
          handoffBlockerCount: 0,
        },
        new Date('invalid'),
      ),
    ).toThrow(/date/i)
  })
})
