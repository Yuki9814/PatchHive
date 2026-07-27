import type { EvidenceItem } from './types'

export const MAX_RESOLUTION_NOTE_LENGTH = 2_000

export function normalizeResolutionNote(value: string | undefined) {
  const note = value?.trim()

  if (!note || note.length > MAX_RESOLUTION_NOTE_LENGTH) {
    return undefined
  }

  return note
}

export function isScannerRiskEvidence(evidence: EvidenceItem) {
  const ruleId = evidence.provenance?.ruleId

  return Boolean(
    evidence.provenance?.importer === 'agent-hygiene' &&
      ruleId &&
      ruleId !== 'scan/summary' &&
      !ruleId.startsWith('discovery/'),
  )
}

export function isAcceptedScannerRiskMissingResolution(evidence: EvidenceItem) {
  return (
    isScannerRiskEvidence(evidence) &&
    evidence.triageStatus === 'accepted' &&
    !normalizeResolutionNote(evidence.resolutionNote)
  )
}

export function isScannerRiskResolvedByRerun(evidence: EvidenceItem) {
  return (
    isScannerRiskEvidence(evidence) &&
    evidence.triageStatus === 'resolved' &&
    evidence.provenance?.resolution?.method === 'complete-rerun'
  )
}
