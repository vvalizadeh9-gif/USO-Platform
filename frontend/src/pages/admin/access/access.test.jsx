// Admin › Access (UEP-25): the segmented level control, the save summary,
// read-only mode for PM and Viewer, and navigation built from /me/access.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { seededAccess, userWithAccess } from '../../../test/seededAccess'
import { appsFor } from '../../../shell/appRegistry'
import LevelControl from './LevelControl'
import { accessFromGrants, diffGrants, grantsPayload, groupFeatures, saveSummary } from './accessModel'

const auth = vi.hoisted(() => ({ current: null }))
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => auth.current }))
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ success: () => {}, error: () => {} }) }))
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() }))
vi.mock('../../../api/client', () => ({ default: api }))

const AccessTab = (await import('./AccessTab')).default

const FEATURES = [
  { key: 'explorer', app: 'Explorer', label: 'Explorer', description: 'Every site', levels: ['view'], sort_order: 10 },
  { key: 'hc_work', app: 'Drive test', label: 'Health check work', description: 'Assign checks', levels: ['view', 'edit'], sort_order: 30 },
  { key: 'exports', app: 'Insights', label: 'Export to Excel', description: 'Workbooks', levels: ['view'], sort_order: 280 },
]
const ROLES = [
  { id: 3, name: 'Coordinator', description: 'Runs checks', landing: 'standard', data_scope_type: 'cra_regions',
    is_system: true, is_category_owner: false, user_count: 4, grants: { hc_work: 'edit', exports: 'view' }, hidden_in_menus: [] },
]

function as(role) {
  return { user: userWithAccess({ id: 1, role: { name: role } }), refreshAccess: vi.fn() }
}

function renderTab() {
  return render(<MemoryRouter><AccessTab /></MemoryRouter>)
}

beforeEach(() => {
  api.get.mockReset()
  api.put.mockReset()
  api.get.mockImplementation((url) => Promise.resolve({
    data: url.endsWith('/features') ? FEATURES : ROLES,
  }))
})

describe('the save summary', () => {
  it('reads "Coordinator: +Explorer (View), −Exports. Affects 4 users."', () => {
    const changes = diffGrants({ hc_work: 'edit', exports: 'view' }, { hc_work: 'edit', explorer: 'view', exports: 'none' })
    expect(saveSummary('Coordinator', changes, FEATURES, 4)).toBe('Coordinator: +Explorer (View), −Export to Excel. Affects 4 users.')
    expect(grantsPayload(changes)).toEqual({ explorer: 'view', exports: 'none' })
  })

  it('names a level change and one user', () => {
    const changes = diffGrants({ hc_work: 'edit' }, { hc_work: 'view' })
    expect(saveSummary('PM', changes, FEATURES, 1)).toBe('PM: Health check work Edit → View. Affects 1 user.')
  })

  it('groups features by app in launcher order', () => {
    expect(groupFeatures(FEATURES).map((g) => g.app)).toEqual(['Explorer', 'Drive test', 'Insights'])
  })
})

describe('the None · View · Edit control', () => {
  it('shows only the levels a feature supports', () => {
    render(<LevelControl feature={FEATURES[0]} value="view" onChange={() => {}} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['None', 'View'])
  })

  it('marks the current level and changes on click and with the arrow keys', () => {
    const onChange = vi.fn()
    render(<LevelControl feature={FEATURES[1]} value="view" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'View' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onChange).toHaveBeenLastCalledWith('edit')
    fireEvent.keyDown(screen.getByRole('group'), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('none')
  })

  it('cannot be changed when disabled', () => {
    render(<LevelControl feature={FEATURES[1]} value="edit" disabled onChange={() => {}} />)
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled()
  })
})

describe('the Access screen', () => {
  it('lets an Admin change a level and confirms with the summary before saving', async () => {
    auth.current = as('Admin')
    api.put.mockResolvedValue({ data: { role: { ...ROLES[0], grants: { hc_work: 'edit', exports: 'view', explorer: 'view' } }, summary: {} } })
    renderTab()
    const explorer = await screen.findByRole('group', { name: 'Explorer' })
    fireEvent.click(within(explorer).getByRole('button', { name: 'View' }))
    expect(screen.getAllByLabelText('Unsaved changes').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Coordinator: +Explorer (View). Affects 4 users.')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/admin/access/roles/3', { grants: { explorer: 'view' } }))
  })

  it.each(['PM', 'Viewer'])('is read only for %s: controls disabled, no Save', async (role) => {
    auth.current = as(role)
    renderTab()
    const group = await screen.findByRole('group', { name: 'Health check work' })
    for (const b of within(group).getAllByRole('button')) expect(b).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Duplicate role/ })).toBeNull()
    expect(screen.getByText('Read only')).toBeInTheDocument()
  })

  it('says what to do when it cannot load', async () => {
    auth.current = as('Admin')
    api.get.mockRejectedValue(new Error('down'))
    renderTab()
    expect(await screen.findByRole('alert')).toHaveTextContent('Access could not be loaded')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('navigation is built from /me/access', () => {
  it('offers Explorer to a contractor only while access grants it', () => {
    const base = seededAccess('Contractor')
    const without = { role: { name: 'Contractor' }, access: { ...base, features: { ...base.features } } }
    delete without.access.features.explorer
    expect(appsFor(without).map((a) => a.id)).not.toContain('explorer')
    const withIt = { role: { name: 'Contractor' }, access: { ...base, features: { ...base.features, explorer: 'view' } } }
    expect(appsFor(withIt).map((a) => a.id)).toContain('explorer')
  })

  it('gives a new role exactly the apps its grants open', () => {
    const cpo = { role: { name: 'CPO' }, access: accessFromGrants({ name: 'CPO', landing: '/explorer', data_scope_type: 'all' }, { explorer: 'view', roles_performance: 'view' }) }
    const apps = appsFor(cpo)
    expect(apps.map((a) => a.id)).toEqual(['explorer', 'insights'])
    expect(apps.find((a) => a.id === 'insights').pages.map((p) => p.id)).toEqual(['roles'])
  })

  it('shows the Admin app with Access and System health, read only, to PM and Viewer', () => {
    for (const role of ['PM', 'Viewer']) {
      const admin = appsFor(userWithAccess({ role: { name: role } })).find((a) => a.id === 'admin')
      expect(admin.pages.map((p) => p.id)).toEqual(expect.arrayContaining(['access', 'system-health']))
      expect(admin.pages.map((p) => p.id)).not.toContain('users')
    }
  })
})
