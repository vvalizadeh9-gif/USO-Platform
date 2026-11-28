// Admin › Data import (UEP-29): the step flow, conflict choices one by one and
// in bulk, Apply disabled while conflicts wait (and saying why), the result
// card, History's actions, and the read-only View level.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyState, barSegments, showValue, totals } from './dataImportModel'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../../../api/client', () => ({ default: api }))

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../../context/ToastContext', () => ({ useToast: () => toast }))

const auth = vi.hoisted(() => ({ user: { id: 7, full_name: 'Parisa PM', role: { name: 'PM' } } }))
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => globalThis.withSeededAccess(auth) }))

const DataImportTab = (await import('../DataImportTab')).default

const COUNTS = {
  dt: { new: 2, same: 1, conflicts: 1, errors: 1 },
  ict: { new: 3, same: 0, conflicts: 0, errors: 0 },
  cra: { new: 0, same: 0, conflicts: 0, errors: 1 },
  rows: 9, row_errors: 2, warnings: ['Unknown column ignored: Notes'], already_imported_as: null,
}
const BATCH = {
  id: 41, number: 4, filename: 'fill.xlsx', status: 'previewed', counts: COUNTS,
  decisions: { new: 5, conflicts: 1, undecided: 1, use_file: 0, to_apply: 5 },
}
const CONFLICT = {
  id: 900, row: 3, site_id: 'S5', site_type: 'New Site', village_code: null, scope: 'site',
  field: 'dt_contractor', field_label: 'DT contractor', uep_value: 'Contractor B',
  uep_source: 'CPM import', file_value: 'Contractor A', kind: 'conflict', decision: null,
}
const HISTORY = [
  { id: 41, number: 4, filename: 'fill.xlsx', status: 'applied', uploaded_by: 'Parisa PM',
    uploaded_at: '2026-11-20T09:00:00+00:00', applied_at: '2026-11-20T09:05:00+00:00',
    counts: { ...COUNTS, records: 12, sites: 2, villages: 3 }, decisions: {} },
  { id: 40, number: 3, filename: 'old.xlsx', status: 'expired', uploaded_by: 'Parisa PM',
    uploaded_at: '2026-11-01T09:00:00+00:00', counts: COUNTS, decisions: {} },
]

function previewResponse(tab) {
  if (tab === 'conflicts') {
    return { tab, total: 1, page: 1, page_size: 50, items: [CONFLICT],
      fields: [{ field: 'dt_contractor', label: 'DT contractor', count: 1 }] }
  }
  if (tab === 'errors') {
    return { tab, total: 1, page: 1, page_size: 50, fields: [],
      items: [{ row: 5, site_id: 'S9', site_type: 'New Site', village_code: '9', status: 'error',
        messages: ['Site/village not found in UEP'] }] }
  }
  return { tab, total: 0, page: 1, page_size: 50, items: [], fields: [] }
}

function setUpApi() {
  api.get.mockReset().mockImplementation((url, config) => {
    if (url === '/data-import/batches') return Promise.resolve({ data: HISTORY })
    if (url.endsWith('/preview')) return Promise.resolve({ data: previewResponse(config.params.tab) })
    return Promise.resolve({ data: new Blob(['x']), headers: {} })
  })
  api.post.mockReset().mockImplementation((url, body) => {
    if (url === '/data-import/batches') return Promise.resolve({ data: BATCH })
    if (url.endsWith('/decisions')) {
      return Promise.resolve({ data: { updated: 1, decisions: { ...BATCH.decisions, undecided: 0,
        use_file: body.decision === 'file' ? 1 : 0, to_apply: body.decision === 'file' ? 6 : 5 } } })
    }
    if (url.endsWith('/apply')) {
      return Promise.resolve({ data: { ...BATCH, status: 'applied',
        counts: { ...COUNTS, applied_changes: 6, records: 12, sites: 2, villages: 3 },
        result: { applied_changes: 6, records: 12 } } })
    }
    if (url.endsWith('/undo')) {
      return Promise.resolve({ data: { ...BATCH, status: 'undone', result: { reverted: 12, kept_rows: 0 } } })
    }
    return Promise.reject(new Error(`unexpected ${url}`))
  })
}

function renderPage() {
  const user = userEvent.setup()
  render(<MemoryRouter><DataImportTab /></MemoryRouter>)
  return user
}

async function uploadFile(user) {
  await user.click(screen.getByRole('button', { name: 'Upload' }))
  const file = new File(['PK'], 'fill.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  await user.upload(screen.getByTestId('di-file'), file)
  await user.click(screen.getByRole('button', { name: 'Check file' }))
  await screen.findByRole('region', { name: 'Summary' })
}

beforeEach(() => {
  setUpApi()
  toast.success.mockReset()
  toast.error.mockReset()
  auth.user = { id: 7, full_name: 'Parisa PM', role: { name: 'PM' } }
})

describe('Data import model', () => {
  it('totals the three groups and drops empty bar segments', () => {
    expect(totals(COUNTS)).toEqual({ new: 5, same: 1, conflicts: 1, errors: 2 })
    expect(barSegments(COUNTS).map((s) => s.key)).toEqual(['new', 'same', 'conflicts', 'errors'])
    expect(barSegments({})).toEqual([])
  })

  it('says why Apply is disabled', () => {
    expect(applyState({ undecided: 2, to_apply: 10 })).toMatchObject({ disabled: true, reason: '2 conflicts still need a choice' })
    expect(applyState({ undecided: 0, to_apply: 0 })).toMatchObject({ disabled: true })
    expect(applyState({ undecided: 0, to_apply: 3240 })).toMatchObject({ disabled: false, label: 'Apply 3,240 changes' })
  })

  it('reads ISO dates as day month year', () => {
    expect(showValue('2026-10-12')).toBe('12 Oct 2026')
    expect(showValue(null)).toBe('—')
    expect(showValue('ICT/123')).toBe('ICT/123')
  })
})

describe('Admin › Data import', () => {
  it('walks Template, Upload and Review, with the template toggle sent to the server', async () => {
    const user = renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Data import' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Template/ })).toHaveAttribute('aria-current', 'step')
    await user.click(screen.getByRole('switch', { name: 'Fill in current UEP values' }))
    await user.click(screen.getByRole('button', { name: 'Download template' }))
    expect(api.get).toHaveBeenCalledWith('/data-import/template', expect.objectContaining({ params: { current: 1 } }))

    await uploadFile(user)
    expect(screen.getByRole('button', { name: /Review/ })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('Unknown column ignored: Notes')).toBeInTheDocument()
  })

  it('keeps Apply disabled until the conflict has a choice, then applies and offers Undo', async () => {
    const user = renderPage()
    await uploadFile(user)
    const apply = screen.getByRole('button', { name: 'Apply 5 changes' })
    expect(apply).toBeDisabled()
    expect(screen.getByText('1 conflict still needs a choice')).toBeInTheDocument()

    const row = (await screen.findByText('Contractor A')).closest('tr')
    expect(within(row).getByText('CPM import')).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Use file' }))
    expect(api.post).toHaveBeenCalledWith('/data-import/batches/41/decisions', { decision: 'file', change_ids: [900] })
    const ready = await screen.findByRole('button', { name: 'Apply 6 changes' })
    expect(ready).toBeEnabled()

    await user.click(ready)
    expect(await screen.findByRole('heading', { name: 'Batch #4 applied' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo batch' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Undo batch' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/data-import/batches/41/undo'))
    expect(await screen.findByRole('heading', { name: 'Batch #4 undone' })).toBeInTheDocument()
  })

  it('applies a bulk choice to every conflict', async () => {
    const user = renderPage()
    await uploadFile(user)
    await screen.findByText('Contractor A')
    await user.click(screen.getByRole('button', { name: 'Keep UEP for all' }))
    expect(api.post).toHaveBeenCalledWith('/data-import/batches/41/decisions', { decision: 'keep', all: true })
  })

  it('lists errors and downloads the error file', async () => {
    const user = renderPage()
    await uploadFile(user)
    await user.click(screen.getByRole('tab', { name: /Errors/ }))
    expect(await screen.findByText('Site/village not found in UEP')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Download error file' }))
    expect(api.get).toHaveBeenCalledWith('/data-import/batches/41/errors.xlsx', { responseType: 'blob' })
  })

  it('shows History with its status chips and actions', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('tab', { name: 'History' }))
    const row = (await screen.findByText('old.xlsx')).closest('tr')
    expect(within(row).getByText('Expired')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /Undo batch/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Undo batch 4' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Change log of batch 4' }))
    expect(api.get).toHaveBeenCalledWith('/data-import/batches/41/changes.xlsx', { responseType: 'blob' })
  })

  it('at View level shows only History, with no Undo', async () => {
    auth.user = {
      id: 8, full_name: 'Vida Viewer', role: { name: 'Viewer' },
      access: { features: { data_import: 'view' }, hidden_in_menus: [], exceptions: [] },
    }
    renderPage()
    expect(screen.queryByRole('tab', { name: 'Import' })).toBeNull()
    await screen.findByText('fill.xlsx')
    expect(screen.queryByRole('button', { name: /Undo batch/ })).toBeNull()
  })
})
