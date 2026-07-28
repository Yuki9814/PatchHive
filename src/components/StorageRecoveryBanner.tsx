export type StorageRecoveryIssue =
  | {
      status: 'corrupt'
      rawPayload: string
    }
  | {
      status: 'future-schema'
      rawPayload: string
      schemaVersion: number
    }
  | {
      status: 'quota'
      errorName: string
    }
  | {
      status: 'unavailable'
      errorName: string
      operation: 'read' | 'write'
    }
  | {
      status: 'conflict'
    }

type StorageRecoveryBannerProps = {
  issue: StorageRecoveryIssue
  onDiscardAndReset: () => void
  onDownloadCurrentWorkspace: () => void
  onDownloadRecoveryEnvelope: () => void
  onReloadStoredWorkspace: () => void
  onRetrySave: () => void
  recoveryEnvelopeAvailable: boolean
}

export function StorageRecoveryBanner({
  issue,
  onDiscardAndReset,
  onDownloadCurrentWorkspace,
  onDownloadRecoveryEnvelope,
  onReloadStoredWorkspace,
  onRetrySave,
  recoveryEnvelopeAvailable,
}: StorageRecoveryBannerProps) {
  const isolatedPayload =
    issue.status === 'corrupt' || issue.status === 'future-schema'
  const storageConflict = issue.status === 'conflict'
  const title =
    issue.status === 'corrupt'
      ? 'Saved workspace needs recovery'
      : issue.status === 'future-schema'
        ? 'Saved workspace is from a newer PatchHive'
        : issue.status === 'quota'
          ? 'Browser storage is full'
          : issue.status === 'conflict'
            ? 'Stored workspace changed elsewhere'
            : 'Browser storage is unavailable'
  const detail =
    issue.status === 'corrupt'
      ? 'PatchHive did not render or overwrite the unreadable saved payload.'
      : issue.status === 'future-schema'
        ? `PatchHive supports schema 8, but the saved payload declares schema ${issue.schemaVersion}. It was not rendered or overwritten.`
        : issue.status === 'quota'
          ? 'The latest workspace changes could not be saved because the browser storage quota was exceeded.'
          : issue.status === 'conflict'
            ? 'Another tab or PatchHive version changed the stored workspace. This tab did not overwrite it.'
            : issue.operation === 'read'
              ? 'The browser denied local storage access, so PatchHive did not read or automatically replace any saved payload.'
              : 'The browser denied or could not provide local storage access while saving.'

  return (
    <section
      className="storage-recovery-banner"
      role="alert"
      aria-labelledby="storage-recovery-title"
      aria-describedby="storage-recovery-detail storage-recovery-mode"
    >
      <div className="storage-recovery-banner__content">
        <h2 id="storage-recovery-title">{title}</h2>
        <p id="storage-recovery-detail">{detail}</p>
        <p id="storage-recovery-mode">
          This tab remains usable in memory only. Download a current workspace backup
          before closing or reloading it.
        </p>
      </div>
      <div className="storage-recovery-banner__actions" aria-label="Storage recovery actions">
        {recoveryEnvelopeAvailable ? (
          <button
            className="secondary-button"
            type="button"
            onClick={onDownloadRecoveryEnvelope}
          >
            Download lossless recovery envelope
          </button>
        ) : null}
        <button
          className="secondary-button"
          type="button"
          onClick={onDownloadCurrentWorkspace}
        >
          Download current workspace backup
        </button>
        {storageConflict ? (
          <button
            className="secondary-button"
            type="button"
            onClick={onReloadStoredWorkspace}
          >
            Reload stored workspace
          </button>
        ) : isolatedPayload ? (
          <button
            className="subtle-button subtle-button--danger"
            type="button"
            onClick={onDiscardAndReset}
          >
            Discard saved data and reset
          </button>
        ) : (
          <button className="secondary-button" type="button" onClick={onRetrySave}>
            Retry browser save
          </button>
        )}
      </div>
    </section>
  )
}
