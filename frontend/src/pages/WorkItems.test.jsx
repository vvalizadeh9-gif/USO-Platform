// All sites (UEP-06 §9): stage chips over one list, bulk assign on the
// stages awaiting an assignment, the export and the pages.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const COUNTS = { All: 230, 'Ready for Assignment': 2, Assigned: 228 }
const site = (id, stage, over = {}) => ({
  id, site_code: `KRM-${id}`, site_type: 'Greenfield', province: 'کرمان', requested_technology: '2G/4G',
  current_stage: stage, project_name: null, launch_date_shamsi: '1405/07/01', village: null, village_count: 0,
  contractor_name: null, ...over,
})

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role: { name: 'PM' } } }) }))
vi.mock('../shell/HomeData', () => ({ useHomeData: () => ({ data: null, error: null }) }))

const api = (await import('../api/client')).default
const WorkItems = (await import('./WorkItems')).default
const { ToastProvider } = await import('../context/ToastContext')

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation((url, config) => {
    if (url === '/work-items/counts') return Promise.resolve({ data: COUNTS })
    if (url === '/reference/provinces') return Promise.resolve({ data: [{ id: 3, name: 'کرمان' }] })
    if (url === '/drive-test/contractors/load')
      return Promise.resolve({ data: [{ contractor_id: 5, name: 'آریا موج', open: 1, late: 0, avg_submit_days: null, provinces: [] }] })
    if (url === '/work-items') {
      const stage = config?.params?.stage
      if (stage === 'Ready for Assignment') return Promise.resolve({ data: [site(1, stage), site(2, stage)] })
      return Promise.resolve({ data: Array.from({ length: 100 }, (_, i) => site(i + 10, 'Assigned', { contractor_name: 'رعد' })) })
    }
    return Promise.resolve({ data: [] })
  })
})

async function draw(path = '/work-items') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider><WorkItems /></ToastProvider>
    </MemoryRouter>,
  )
  await act(async () => {})
}

describe('All sites', () => {
  it('heads the page with every site in scope', async () => {
    await draw()
    expect(screen.getByRole('heading', { level: 1, name: 'All sites' })).toBeInTheDocument()
    expect(screen.getByText('230 sites', { selector: '.uw-heading-meta b' })).toBeInTheDocument()
  })

  it('offers the stages as a tab list with their counts, the list as its panel', async () => {
    await draw()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([
      'All230', 'HC in progress0', 'HC review0', 'Ready for assignment2', 'Assigned228',
      'Returned0', 'DT submitted0', 'DT done0', 'Problematic0',
    ])
    const selected = screen.getByRole('tab', { selected: true })
    expect(selected).toHaveTextContent('All')
    expect(document.getElementById('sites-panel')).toHaveAttribute('aria-labelledby', selected.id)
  })

  it('moves between stages with the arrow keys', async () => {
    await draw()
    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'End' })
    await act(async () => {})
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Problematic')
    expect(api.get).toHaveBeenCalledWith('/work-items', expect.objectContaining({ params: expect.objectContaining({ stage: 'Problematic' }) }))
  })

  it('shows the fixed columns and the Stage as dot and word', async () => {
    await draw()
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads).toEqual(['Site ID', 'Province', 'Type', 'Requested tech', 'Stage', 'Contractor', 'On air'])
    const first = screen.getByText('KRM-10').closest('tr')
    expect(within(first).getByText('Assigned').closest('.uw-stage')).toHaveClass('is-ongoing')
    expect(within(first).getByText('۱۴۰۵/۰۷/۰۱')).toHaveAttribute('lang', 'fa')
  })

  it('adds a stage’s own date columns', async () => {
    await draw('/work-items?stage=Assigned')
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(
      expect.arrayContaining(['Assigned', 'Aging (days)', 'Assigned by']),
    )
  })

  it('pages through the stage', async () => {
    const user = userEvent.setup()
    await draw()
    expect(screen.getByText('1–100 of 230')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(api.get).toHaveBeenCalledWith('/work-items', expect.objectContaining({ params: expect.objectContaining({ offset: 100 }) }))
  })

  it('bulk-assigns on Ready for assignment with the contractor cards', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValue({ data: { assigned: 2, batch_id: 8 } })
    await draw('/work-items?stage=Ready%20for%20Assignment')
    await user.click(screen.getByRole('checkbox', { name: 'Select every site shown' }))
    const card = screen.getAllByRole('button').find((b) => b.classList.contains('uw-assign-card'))
    await user.click(card)
    expect(api.post).toHaveBeenCalledWith('/work-items/assign', { work_item_ids: [1, 2], contractor_id: 5, assignment_type: 'official' })
    expect(await screen.findByText('✓ 2 sites assigned to آریا موج.', { selector: '.uw-notice-text' })).toBeInTheDocument()
  })

  it('offers no selection on a stage nobody assigns from', async () => {
    await draw()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('exports the list it shows', async () => {
    const user = userEvent.setup()
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const serve = api.get.getMockImplementation()
    api.get.mockImplementation((url, config) =>
      url === '/work-items/export' ? Promise.resolve({ data: new Blob(['x']) }) : serve(url, config),
    )
    await draw('/work-items?stage=Assigned')
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(api.get).toHaveBeenCalledWith('/work-items/export', expect.objectContaining({ params: expect.objectContaining({ stage: 'Assigned' }) }))
  })
})

describe('All sites, opened from the header search', () => {
  const lastCall = (url) => api.get.mock.calls.filter(([u]) => u === url).at(-1)[1].params

  it('starts with the search in the address already typed into the box and applied', async () => {
    await draw('/work-items?q=KRM-12')
    expect(screen.getByRole('searchbox', { name: /Search site ID/ })).toHaveValue('KRM-12')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350))
    })
    expect(lastCall('/work-items').q).toBe('KRM-12')
    expect(lastCall('/work-items/counts').q).toBe('KRM-12')
  })

  it('narrows to one contractor, for the list and the stage counts alike, and says so', async () => {
    await draw('/work-items?contractor_id=5&contractor=Acme%20Telecom')
    expect(lastCall('/work-items').contractor_id).toBe('5')
    expect(lastCall('/work-items/counts').contractor_id).toBe('5')
    expect(screen.getByRole('button', { name: /Contractor: Acme Telecom/ })).toBeInTheDocument()
  })

  it('drops the contractor when its chip is cleared', async () => {
    await draw('/work-items?contractor_id=5&contractor=Acme%20Telecom')
    await userEvent.click(screen.getByRole('button', { name: /Contractor: Acme Telecom/ }))
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /Contractor: Acme Telecom/ })).not.toBeInTheDocument()
    expect(lastCall('/work-items').contractor_id).toBeUndefined()
  })

  it('keeps the contractor when the stage changes', async () => {
    await draw('/work-items?contractor_id=5&contractor=Acme%20Telecom')
    await userEvent.click(screen.getByRole('tab', { name: /^Assigned/ }))
    await act(async () => {})
    expect(lastCall('/work-items')).toMatchObject({ stage: 'Assigned', contractor_id: '5' })
  })
})
