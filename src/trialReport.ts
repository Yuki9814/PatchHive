export const MAINTAINER_TRIAL_REPORT_FORMAT =
  'patchhive.maintainer-trial.v1' as const
export const MIN_TRIAL_ELAPSED_MINUTES = 1
export const MAX_TRIAL_ELAPSED_MINUTES = 1_440

export const trialOutcomes = ['completed', 'partially-completed', 'blocked'] as const
export const trialClarityRatings = [1, 2, 3, 4, 5] as const
export const trialReuseIntents = ['yes', 'maybe', 'no'] as const
export const trialFrictionAreas = [
  'none',
  'setup',
  'scanner-intake',
  'evidence-triage',
  'approvals',
  'handoff',
  'other',
] as const

export type TrialOutcome = (typeof trialOutcomes)[number]
export type TrialClarityRating = (typeof trialClarityRatings)[number]
export type TrialReuseIntent = (typeof trialReuseIntents)[number]
export type TrialFrictionArea = (typeof trialFrictionAreas)[number]

export type MaintainerTrialAnswers = {
  outcome: TrialOutcome
  elapsedMinutes: number
  clarityRating: TrialClarityRating
  reuseIntent: TrialReuseIntent
  primaryFriction: TrialFrictionArea
}

export type MaintainerTrialContext = {
  handoffReady: boolean
  handoffBlockerCount: number
}

export type MaintainerTrialReport = {
  format: typeof MAINTAINER_TRIAL_REPORT_FORMAT
  generatedOn: string
  participantConsent: 'affirmed'
  privacy: {
    storedByPatchHive: false
    sentByPatchHive: false
    includesMissionContent: false
    includesRepositoryIdentity: false
    includesBrowserIdentity: false
  }
  workflow: MaintainerTrialContext
  answers: MaintainerTrialAnswers
}

function isOneOf<T extends readonly unknown[]>(
  values: T,
  candidate: unknown,
): candidate is T[number] {
  return values.includes(candidate)
}

export function buildMaintainerTrialReport(
  answers: MaintainerTrialAnswers,
  context: MaintainerTrialContext,
  generatedAt = new Date(),
): MaintainerTrialReport {
  if (!isOneOf(trialOutcomes, answers.outcome)) {
    throw new Error('Choose a supported trial outcome.')
  }

  if (
    !Number.isInteger(answers.elapsedMinutes) ||
    answers.elapsedMinutes < MIN_TRIAL_ELAPSED_MINUTES ||
    answers.elapsedMinutes > MAX_TRIAL_ELAPSED_MINUTES
  ) {
    throw new Error(
      `Elapsed time must be a whole number from ${MIN_TRIAL_ELAPSED_MINUTES} to ${MAX_TRIAL_ELAPSED_MINUTES} minutes.`,
    )
  }

  if (!isOneOf(trialClarityRatings, answers.clarityRating)) {
    throw new Error('Choose a workflow clarity rating from 1 to 5.')
  }

  if (!isOneOf(trialReuseIntents, answers.reuseIntent)) {
    throw new Error('Choose whether you would use PatchHive again.')
  }

  if (!isOneOf(trialFrictionAreas, answers.primaryFriction)) {
    throw new Error('Choose the primary point of friction.')
  }

  if (
    !Number.isInteger(context.handoffBlockerCount) ||
    context.handoffBlockerCount < 0
  ) {
    throw new Error('Handoff blocker count must be a non-negative integer.')
  }

  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error('Trial report date is invalid.')
  }

  return {
    format: MAINTAINER_TRIAL_REPORT_FORMAT,
    generatedOn: generatedAt.toISOString().slice(0, 10),
    participantConsent: 'affirmed',
    privacy: {
      storedByPatchHive: false,
      sentByPatchHive: false,
      includesMissionContent: false,
      includesRepositoryIdentity: false,
      includesBrowserIdentity: false,
    },
    workflow: {
      handoffReady: context.handoffReady,
      handoffBlockerCount: context.handoffBlockerCount,
    },
    answers: {
      outcome: answers.outcome,
      elapsedMinutes: answers.elapsedMinutes,
      clarityRating: answers.clarityRating,
      reuseIntent: answers.reuseIntent,
      primaryFriction: answers.primaryFriction,
    },
  }
}

export function serializeMaintainerTrialReport(
  report: MaintainerTrialReport,
) {
  return `${JSON.stringify(report, null, 2)}\n`
}
