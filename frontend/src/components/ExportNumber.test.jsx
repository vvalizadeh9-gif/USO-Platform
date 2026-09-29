import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }))
vi.mock('../lib/download', async (importOriginal) => ({
  ...(await importOriginal()),
  saveBlob: vi.fn(),
}))

const api = (await import('../api/client')).default
const { saveBlob } = await import('../lib/download')
const { default: ExportNumber, ExportFeedback } = await import('./ExportNumber')

function draw(props = {}) {
  const outer = vi.fn()
  render(
    <ExportFeedback>
      <div onClick={outer}>
        <ExportNumber value={205} gap="pending_cra" lens="coordinator" keyValue="V. Hashemi" {...props} />
      </div>
    </ExportFeedback>
  )
  return { outer }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ExportNumber', () => {
  it('says what it will export, in its label and its tooltip', () => {
    draw()
    const button = screen.getByRole('button', {
      name: 'Export 205 villages (CRA pending · Coordinator V. Hashemi) to Excel',
    })
    expect(button).toHaveAttribute('title', button.getAttribute('aria-label'))
    expect(button).toHaveTextContent('205')
  })

  it('names a map scope in the label', () => {
    draw({ lens: undefined, keyValue: undefined, gap: 'ict_approved', value: 285, scope: 'province:تهران', scopeLabel: 'Tehran' })
    expect(screen.getByRole('button')).toHaveAccessibleName('Export 285 villages (ICT approved · Tehran) to Excel')
  })

  it('asks the server for exactly the clicked figure, and saves the file it names', async () => {
    api.get.mockResolvedValue({
      data: new Blob(['x']),
      headers: { 'content-disposition': 'attachment; filename="uep-pending-cra-coordinator-v-hashemi-1405-07-07.xlsx"' },
    })
    const { outer } = draw()
    await userEvent.click(screen.getByRole('button'))
    expect(api.get).toHaveBeenCalledWith('/gaps/villages.xlsx', {
      params: { gap: 'pending_cra', lens: 'coordinator', key: 'V. Hashemi' },
      responseType: 'blob',
    })
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'uep-pending-cra-coordinator-v-hashemi-1405-07-07.xlsx')
    expect(outer).not.toHaveBeenCalled()
    expect(await screen.findByText('Exported 205 villages')).toBeInTheDocument()
  })

  it('spins and is disabled while the file is built', async () => {
    let finish
    api.get.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    draw()
    const button = screen.getByRole('button')
    await userEvent.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('export-spinner')).toBeInTheDocument()
    finish({ data: new Blob(['x']), headers: {} })
    await waitFor(() => expect(button).not.toBeDisabled())
    expect(screen.queryByTestId('export-spinner')).not.toBeInTheDocument()
  })

  it("shows the server's reason in an error banner", async () => {
    api.get.mockRejectedValue({
      response: {
        status: 403,
        data: new Blob([JSON.stringify({ detail: 'You may only export your own villages' })]),
      },
    })
    draw()
    await userEvent.click(screen.getByRole('button'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('You may only export your own villages (403)')
    expect(saveBlob).not.toHaveBeenCalled()
  })

  it('draws a zero as a plain number: there is nothing to export', () => {
    draw({ value: 0 })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})
