import { useRef, useState, type ChangeEvent } from 'react'
import {
  MAX_EVIDENCE_PACK_IMPORT_BYTES,
  createEvidencePack,
  verifyEvidencePack,
  type EvidencePack,
  type EvidencePackVerification,
} from '../evidencePack'
import type { Mission } from '../types'

type EvidencePackPanelProps = {
  mission: Mission
  storageMutationLocked: boolean
  onImportVerifiedEvidencePack: (
    verification: EvidencePackVerification,
  ) => Promise<boolean> | boolean
  onStatusMessage: (message: string) => void
}

type EvidencePackPreview = {
  missionTitle: string
  repo: string
  evidenceCount: number
  redactionCount: number
  digest: string
}

function toPreview(
  pack: EvidencePack,
  digest: string,
): EvidencePackPreview {
  return {
    missionTitle: pack.mission.title,
    repo: pack.mission.repo,
    evidenceCount: pack.mission.evidence.length,
    redactionCount: pack.redactions.length,
    digest,
  }
}

function safeFileStem(title: string) {
  const stem = title
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

  return stem || 'mission'
}

function downloadLocalJson(serialized: string, fileName: string) {
  const blob = new Blob([serialized], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export function EvidencePackPanel({
  mission,
  storageMutationLocked,
  onImportVerifiedEvidencePack,
  onStatusMessage,
}: EvidencePackPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const verificationGenerationRef = useRef(0)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [expectedDigest, setExpectedDigest] = useState('')
  const [verification, setVerification] =
    useState<EvidencePackVerification | null>(null)
  const [preview, setPreview] = useState<EvidencePackPreview | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [exportedDigest, setExportedDigest] = useState('')

  const clearVerification = () => {
    setVerification(null)
    setPreview(null)
    setErrorMessage('')
  }

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    verificationGenerationRef.current += 1
    setSelectedFile(file)
    setExpectedDigest('')
    setExportedDigest('')
    setBusy(false)
    clearVerification()

    if (file) {
      onStatusMessage(`Selected ${file.name}. Verify it locally before importing.`)
    }
  }

  const downloadEvidencePack = async () => {
    if (busy) {
      return
    }

    setBusy(true)

    try {
      const result = await createEvidencePack({ mission })
      setExportedDigest(result.digest)
      downloadLocalJson(
        result.serialized,
        `${safeFileStem(mission.title)}-evidence-pack.json`,
      )
      onStatusMessage('Evidence Pack downloaded locally. No network request was made.')
    } catch (error) {
      onStatusMessage(
        error instanceof Error
          ? error.message
          : 'Evidence Pack export failed locally.',
      )
    } finally {
      setBusy(false)
    }
  }

  const copyDigest = async (digest: string) => {
    try {
      await navigator.clipboard.writeText(digest)
      onStatusMessage('Evidence Pack digest copied.')
    } catch {
      onStatusMessage('Clipboard access failed. Select the digest manually.')
    }
  }

  const verifySelectedFile = async () => {
    if (!selectedFile || busy) {
      return
    }

    const generation = verificationGenerationRef.current + 1
    verificationGenerationRef.current = generation
    const file = selectedFile
    const trustedDigest = expectedDigest.trim() || undefined
    clearVerification()

    if (file.size > MAX_EVIDENCE_PACK_IMPORT_BYTES) {
      setErrorMessage('Evidence Pack exceeds the 1 MB local verification limit.')
      onStatusMessage('Evidence Pack verification failed: file is larger than 1 MB.')
      return
    }

    setBusy(true)

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const result = await verifyEvidencePack(
        bytes,
        trustedDigest,
      )

      if (generation !== verificationGenerationRef.current) {
        return
      }

      setVerification(result)
      setPreview(toPreview(result.pack, result.digest))
      onStatusMessage('Evidence Pack integrity verified locally.')
    } catch (error) {
      if (generation !== verificationGenerationRef.current) {
        return
      }

      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Evidence Pack integrity verification failed.',
      )
      onStatusMessage('Evidence Pack verification failed. Nothing is available to import.')
    } finally {
      if (generation === verificationGenerationRef.current) {
        setBusy(false)
      }
    }
  }

  const importVerifiedPack = async () => {
    if (!verification || !preview || storageMutationLocked || busy) {
      if (storageMutationLocked) {
        onStatusMessage(
          'Evidence Pack import is blocked while the saved workspace is write-protected.',
        )
      }
      return
    }

    setBusy(true)

    try {
      const imported = await onImportVerifiedEvidencePack(verification)

      if (imported) {
        verificationGenerationRef.current += 1
        setSelectedFile(null)
        setExpectedDigest('')
        setExportedDigest('')
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        clearVerification()
      }
    } finally {
      setBusy(false)
    }
  }

  const digest = preview?.digest || exportedDigest

  return (
    <section
      aria-labelledby="evidence-pack-heading"
      className="inspector-panel evidence-pack-panel"
      id="panel-evidence-pack"
    >
      <div className="panel-title">
        <h2 id="evidence-pack-heading">Evidence Pack</h2>
        <span>local only</span>
      </div>

      <p className="muted-copy">
        Export a portable mission snapshot or verify one locally before importing it. Evidence
        Pack checks do not establish who produced the file.
      </p>

      <button
        className="secondary-button"
        disabled={busy}
        type="button"
        onClick={downloadEvidencePack}
      >
        {busy ? 'Working…' : 'Download Evidence Pack'}
      </button>

      {digest ? (
        <div className="evidence-pack-digest" aria-label="Evidence Pack digest">
          <strong>SHA-256 digest</strong>
          <code>{digest}</code>
          <button
            className="subtle-button"
            type="button"
            onClick={() => void copyDigest(digest)}
          >
            Copy digest
          </button>
        </div>
      ) : null}

      <label>
        Trusted SHA-256 (optional)
        <input
          disabled={busy}
          inputMode="text"
          spellCheck={false}
          value={expectedDigest}
          onChange={(event) => {
            verificationGenerationRef.current += 1
            setExpectedDigest(event.currentTarget.value)
            setBusy(false)
            clearVerification()
          }}
        />
      </label>

      <div className="evidence-pack-file-actions">
        <button
          className="subtle-button"
          disabled={busy}
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          Choose Evidence Pack file
        </button>
        <input
          ref={fileInputRef}
          accept=".json,application/json"
          aria-label="Evidence Pack file"
          className="file-input"
          disabled={busy}
          type="file"
          onChange={chooseFile}
        />
        <button
          className="primary-action"
          disabled={!selectedFile || busy}
          type="button"
          onClick={() => void verifySelectedFile()}
        >
          {busy ? 'Verifying…' : 'Verify Evidence Pack'}
        </button>
      </div>

      {selectedFile ? (
        <small className="evidence-pack-file-name">
          Selected file: {selectedFile.name} ({selectedFile.size.toLocaleString()} bytes)
        </small>
      ) : null}

      {errorMessage ? (
        <div className="evidence-pack-error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      {preview && verification ? (
        <div className="evidence-pack-preview" aria-label="Verified Evidence Pack preview">
          <strong>Integrity self-check passed</strong>
          <p>Authenticity remains unverified</p>
          <dl>
            <div>
              <dt>Mission</dt>
              <dd>{preview.missionTitle}</dd>
            </div>
            <div>
              <dt>Repository</dt>
              <dd>{preview.repo}</dd>
            </div>
            <div>
              <dt>Evidence count</dt>
              <dd>{preview.evidenceCount}</dd>
            </div>
            <div>
              <dt>Redaction count</dt>
              <dd>{preview.redactionCount}</dd>
            </div>
            <div>
              <dt>Full digest</dt>
              <dd>
                <code>{preview.digest || 'Unavailable'}</code>
              </dd>
            </div>
          </dl>
          <button
            className="primary-action"
            disabled={storageMutationLocked || busy}
            type="button"
            onClick={() => void importVerifiedPack()}
          >
            Import verified mission
          </button>
          {storageMutationLocked ? (
            <small>Import is disabled while the saved workspace is write-protected.</small>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
