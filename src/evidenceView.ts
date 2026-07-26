import type {
  EvidenceItem,
  EvidenceTriageStatus,
  ScanSeverity,
} from './types'
import type { EvidenceFilter } from './workspaceUi'

export const EVIDENCE_PAGE_SIZE = 25

export type EvidenceSeverityFilter = 'all' | ScanSeverity
export type EvidenceTriageFilter = 'all' | EvidenceTriageStatus

export type EvidenceViewFilters = {
  kind: EvidenceFilter
  stageId: string
  agentId: string
  severity: EvidenceSeverityFilter
  triage: EvidenceTriageFilter
}

const severityOrder: Record<ScanSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}

const triageOrder: Record<EvidenceTriageStatus, number> = {
  open: 0,
  accepted: 1,
  resolved: 2,
}

function compareText(left = '', right = '') {
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function compareEvidence(left: EvidenceItem, right: EvidenceItem) {
  const severityDifference =
    (left.severity ? severityOrder[left.severity] : 5) -
    (right.severity ? severityOrder[right.severity] : 5)

  if (severityDifference !== 0) return severityDifference

  const triageDifference =
    (left.triageStatus ? triageOrder[left.triageStatus] : 3) -
    (right.triageStatus ? triageOrder[right.triageStatus] : 3)

  return (
    triageDifference ||
    compareText(left.filePath, right.filePath) ||
    compareText(left.title, right.title) ||
    compareText(left.detail, right.detail) ||
    compareText(left.id, right.id)
  )
}

export function filterAndSortEvidence(
  evidence: EvidenceItem[],
  filters: EvidenceViewFilters,
) {
  return evidence
    .filter((item) => {
      if (filters.kind === 'unlinked' && (item.stageId || item.agentId)) {
        return false
      }

      if (
        filters.kind !== 'all' &&
        filters.kind !== 'unlinked' &&
        item.kind !== filters.kind
      ) {
        return false
      }

      return (
        (filters.stageId === 'all' || item.stageId === filters.stageId) &&
        (filters.agentId === 'all' || item.agentId === filters.agentId) &&
        (filters.severity === 'all' || item.severity === filters.severity) &&
        (filters.triage === 'all' || item.triageStatus === filters.triage)
      )
    })
    .sort(compareEvidence)
}
