// The Mojri import screen: upload, preview, confirm.
//
// The promise this file protects is the one the screen is built around —
// **nothing is written before Confirm, and Confirm does not exist until the
// preview is on the screen.** A Confirm button that renders before the preview
// is a person approving numbers they have not seen.
//
// The other two are the losses a reconciliation makes quietly: a row whose
// village_id matched nothing, and a village that was in the tracker and has
// dropped out of this month's file. Both are named on screen, one by one.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

const api = (await import('../../api/client')).default
const MojriImport = (await import('./MojriImport')).default

const preview = (over = {}) => ({
  filename: 'mojri.xlsx',
  digest: 'abc123',
  total_rows: 12,
  matched: 10,
  unmatched: 2,
  exceptions: [
    { row: 4, village_id: 999, reason: 'No village with that id' },
    { row: 7, village_id: 41, reason: 'Repeated village_id (already on row 6)' },
  ],
  exceptions_truncated: 0,
  authorities: {
    ict: {
      in_tracker: 6,
      needs_look: 2,
      not_in_tracker: 2,
      moving_to_in_tracker: 5,
      moving_to_needs_look: 2,
    },
    cra: {
      in_tracker: 3,
      needs_look: 0,
      not_in_tracker: 7,
      moving_to_in_tracker: 3,
      moving_to_needs_look: 0,
    },
  },
  disappeared: [{ village_id: 20, village: 'village twenty', authorities: ['ICT'] }],
  disappeared_count: 1,
  ...over,
})

function draw() {
  return render(
    <MemoryRouter>
      <MojriImport />
    </MemoryRouter>
  )
}

function xlsx(name = 'filled.xlsx') {
  return new File(['x'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

async function choose(file = xlsx(), { applyAccept = true } = {}) {
  await userEvent.upload(screen.getByLabelText('Filled template'), file, {
    applyAccept,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('preview before write', () => {
  it('offers no Confirm until a preview has been read', async () => {
    api.post.mockResolvedValue({ data: preview() })
    draw()

    expect(screen.queryByRole('button', { name: /Confirm/ })).not.toBeInTheDocument()
    await choose()
    // A chosen file is not a preview.
    expect(screen.queryByRole('button', { name: /Confirm/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByTestId('mojri-preview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirm/ })).toBeInTheDocument()

    // And the only call so far was the preview: nothing was written.
    expect(api.post).toHaveBeenCalledTimes(1)
    expect(api.post.mock.calls[0][0]).toBe('/mojri/import/preview')
  })

  it('sends the digest the preview returned, so the file cannot have changed', async () => {
    api.post.mockResolvedValueOnce({ data: preview() })
    api.post.mockResolvedValueOnce({ data: { ...preview(), import_run_id: 3 } })
    draw()
    await choose()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByTestId('mojri-preview')
    await userEvent.click(screen.getByRole('button', { name: /Confirm/ }))

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
    const [url, body] = api.post.mock.calls[1]
    expect(url).toBe('/mojri/import/commit')
    expect(body.get('digest')).toBe('abc123')
    expect(await screen.findByTestId('mojri-done')).toBeInTheDocument()
  })

  it('drops a stale preview when another file is chosen', async () => {
    api.post.mockResolvedValue({ data: preview() })
    draw()
    await choose()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByTestId('mojri-preview')

    await choose(xlsx('another.xlsx'))
    expect(screen.queryByTestId('mojri-preview')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Confirm/ })).not.toBeInTheDocument()
  })
})

describe('what the preview will not hide', () => {
  beforeEach(() => {
    api.post.mockResolvedValue({ data: preview() })
  })

  it('names the rows that will not be imported, one by one', async () => {
    draw()
    await choose()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))

    const panel = await screen.findByTestId('mojri-preview')
    expect(panel).toHaveTextContent('row 4 (No village with that id)')
    expect(panel).toHaveTextContent('row 7 (Repeated village_id (already on row 6))')
  })

  it('flags a village that has dropped out of this month’s file', async () => {
    draw()
    await choose()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))

    const panel = await screen.findByTestId('mojri-preview')
    expect(panel).toHaveTextContent('village twenty (ICT)')
    expect(panel).toHaveTextContent(/left exactly as they are/)
  })

  it('reports both authorities separately, and what is moving', async () => {
    draw()
    await choose()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))

    const ict = await screen.findByRole('row', { name: /^ICT/ })
    expect(ict).toHaveTextContent('+5 in tracker')
    expect(ict).toHaveTextContent('+2 needs a look')
    const cra = screen.getByRole('row', { name: /^CRA/ })
    expect(cra).toHaveTextContent('+3 in tracker')
  })
})

describe('when something is wrong', () => {
  it('refuses a file that is not an .xlsx without asking the server', async () => {
    draw()
    // applyAccept off, because the input's accept=".xlsx" would otherwise
    // drop the file before the component ever sees it -- and accept is a hint
    // a browser may ignore, which is why the component checks as well.
    await choose(new File(['x'], 'mojri.csv', { type: 'text/csv' }), {
      applyAccept: false,
    })
    expect(await screen.findByText(/Choose the .xlsx template/)).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('shows the server’s reason rather than a generic failure', async () => {
    api.post.mockRejectedValue({
      response: { data: { detail: 'That file has no village_id column.' } },
    })
    draw()
    await choose()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))

    expect(
      await screen.findByText('That file has no village_id column.')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('mojri-preview')).not.toBeInTheDocument()
  })
})
