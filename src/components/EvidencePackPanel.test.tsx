import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createEvidencePack } from '../evidencePack'
import { createDefaultWorkspace } from '../storage'
import { EvidencePackPanel } from './EvidencePackPanel'

describe('EvidencePackPanel', () => {
  it('locks file identity during verification and clears the native input after import', async () => {
    const user = userEvent.setup()
    const mission = createDefaultWorkspace().missions[0]
    const result = await createEvidencePack({
      mission,
      generatedAt: '2026-08-21T00:00:00.000Z',
    })
    const bytes = new TextEncoder().encode(result.serialized)
    let releaseRead: (() => void) | undefined
    const delayedFile = new File([result.serialized], 'delayed-pack.json', {
      type: 'application/json',
    })
    Object.defineProperty(delayedFile, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(
        () =>
          new Promise<ArrayBuffer>((resolve) => {
            releaseRead = () => resolve(bytes.slice().buffer as ArrayBuffer)
          }),
      ),
    })
    const onImport = vi.fn().mockResolvedValue(true)

    render(
      <EvidencePackPanel
        mission={mission}
        onImportVerifiedEvidencePack={onImport}
        onStatusMessage={vi.fn()}
        storageMutationLocked={false}
      />,
    )

    const fileInput = screen.getByLabelText('Evidence Pack file')
    fireEvent.change(fileInput, { target: { files: [delayedFile] } })
    await user.click(screen.getByRole('button', { name: 'Verify Evidence Pack' }))

    expect(fileInput).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Choose Evidence Pack file' })).toBeDisabled()
    expect(screen.getByLabelText(/trusted sha-256/i)).toBeDisabled()

    releaseRead?.()
    expect(await screen.findByText('Integrity self-check passed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Import verified mission' }))
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(fileInput).toHaveValue('')
    expect(screen.queryByText('Integrity self-check passed')).not.toBeInTheDocument()
  })
})
