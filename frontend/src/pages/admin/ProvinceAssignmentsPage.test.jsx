// Admin > Province assignments (UEP-17 §7): the grid, a click moving the
// owner, Discard, Update and its label, Revert from the toast, the History
// drawer and its focus return, arrow keys, the Viewer, and the loading, error
// and 409 states.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { conflictText, historyLine } from './provinceAssignments'

const auth = vi.hoisted(() => ({ user: { id: 1, role: { name: 'PM' } }, isAdmin: false }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }))
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }))
vi.mock('../../api/client', () => ({ default: api }))

const ProvinceAssignmentsPage = (await import('./ProvinceAssignmentsPage')).default

const HOSSEIN = 11
const AMIR = 12
const ZOHREH = 13
const FARID = 14

const P = (...names) => names.map((en) => ({ fa: en, en }))
const REGIONS = [
  ['Azar', P('Ardabil', 'East Azerbaijan', 'West Azerbaijan'), HOSSEIN],
  ['Central', P('Chaharmahal & Bakhtiari', 'Isfahan', 'Markazi', 'Qom', 'Yazd'), HOSSEIN],
  ['North', P('Alborz', 'Mazandaran', 'Semnan', 'Tehran'), AMIR],
  ['North East', P('Golestan', 'North Khorasan', 'Razavi Khorasan', 'South Khorasan'), ZOHREH],
  ['North West', P('Gilan', 'Qazvin', 'Zanjan'), AMIR],
  ['South', P('Bushehr', 'Fars', 'Kohgiluyeh & Boyer-Ahmad'), ZOHREH],
  ['South East', P('Hormozgan', 'Kerman', 'Sistan & Baluchestan'), FARID],
  ['South West', P('Ilam', 'Khuzestan', 'Lorestan'), ZOHREH],
  ['West', P('Hamadan', 'Kermanshah', 'Kurdistan'), HOSSEIN],
]

function overview(owners = {}) {
  const regions = REGIONS.map(([name, provinces, owner]) => ({
    name, provinces, coordinator_user_id: owners[name] ?? owner, coordinator_name: null,
  }))
  const people = [[HOSSEIN, 'Hossein', 'HK'], [AMIR, 'Amir', 'AR'], [ZOHREH, 'Zohreh', 'ZM'], [FARID, 'Farid', 'FT']]
  const coordinators = people.map(([user_id, name, initials], i) => {
    const mine = regions.filter((r) => r.coordinator_user_id === user_id)
    return {
      user_id, name, initials, colour_index: i, linked: true,
      regions: mine.length, provinces: mine.reduce((n, r) => n + r.provinces.length, 0),
    }
  })
  return {
    regions, coordinators, total_provinces: 31,
    last_change: { at: '2026-10-12T09:00:00Z', by: 'Vahid' },
  }
}

const HISTORY = [
  { change_id: 'c2', by: 'Vahid', at: '2026-10-12T09:00:00Z', changes: [{ cra_region: 'Central', provinces: 5, old: 'Hossein', new: 'Zohreh' }] },
  { change_id: 'c1', by: 'System', at: '2026-10-01T09:00:00Z', changes: [{ cra_region: 'Azar', provinces: 3, old: 'Hossein', new: 'Hossein' }] },
]

function renderPage() {
  return render(<MemoryRouter><ProvinceAssignmentsPage /></MemoryRouter>)
}

const row = (region) => screen.getByRole('radiogroup', { name: `Coordinator for ${region}` })
const cell = (region, name) => within(row(region)).getByRole('radio', { name })
const updateButton = () => screen.getByRole('button', { name: /^Update/ })

async function ready() {
  renderPage()
  await screen.findByRole('radiogroup', { name: 'Coordinator for Central' })
}

beforeEach(() => {
  auth.user = { id: 1, role: { name: 'PM' } }
  auth.isAdmin = false
  api.get.mockReset()
  api.put.mockReset()
  api.post.mockReset()
  api.get.mockImplementation((url) => Promise.resolve({ data: url.includes('/history') ? HISTORY : overview() }))
})

describe('the grid', () => {
  it('renders 9 regions with their counts and every province as a tag', async () => {
    await ready()
    expect(screen.getAllByRole('radiogroup')).toHaveLength(9)
    const central = row('Central')
    expect(within(central).getByText('5 provinces')).toBeInTheDocument()
    const tags = within(central).getByRole('list', { name: 'Central provinces' })
    expect(within(tags).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Chaharmahal & Bakhtiari', 'Isfahan', 'Markazi', 'Qom', 'Yazd'])
    expect(cell('Central', 'Hossein')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Coordinators by CRA region · 9 regions · 31 provinces · last change 12 Oct 2026 by Vahid/)).toBeInTheDocument()
  })

  it('only the owner cell of each row is in the tab order', async () => {
    await ready()
    const tabbable = within(row('North')).getAllByRole('radio').filter((r) => r.tabIndex === 0)
    expect(tabbable).toEqual([cell('North', 'Amir')])
  })
})

describe('editing', () => {
  it('a click moves the owner, marks the row and updates the counts', async () => {
    await ready()
    expect(updateButton()).toBeDisabled()
    expect(updateButton()).toHaveTextContent(/^Update$/)

    await userEvent.click(cell('Central', 'Zohreh'))
    expect(cell('Central', 'Zohreh')).toHaveAttribute('aria-checked', 'true')
    expect(cell('Central', 'Hossein')).toHaveAttribute('aria-checked', 'false')
    expect(row('Central')).toHaveClass('is-edited')
    expect(within(row('Central')).getByText('Hossein → Zohreh')).toBeInTheDocument()
    expect(row('Central').querySelector('.pa-previous')).not.toBeNull()

    const heads = screen.getAllByText(/^\d+ regions?$/).map((el) => el.textContent)
    expect(heads).toEqual(['2 regions', '2 regions', '4 regions', '1 region'])
    expect(screen.getByText(/^1 unsaved change ·/)).toBeInTheDocument()
    expect(updateButton()).toHaveTextContent('Update 1')
    expect(updateButton()).toBeEnabled()
  })

  it('clicking the previous owner again undoes the edit', async () => {
    await ready()
    await userEvent.click(cell('Central', 'Zohreh'))
    await userEvent.click(cell('Central', 'Hossein'))
    expect(row('Central')).not.toHaveClass('is-edited')
    expect(updateButton()).toBeDisabled()
  })

  it('Discard moves every edited badge back', async () => {
    await ready()
    await userEvent.click(cell('Central', 'Zohreh'))
    await userEvent.click(cell('West', 'Farid'))
    expect(screen.getByText(/^2 unsaved changes ·/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(cell('Central', 'Hossein')).toHaveAttribute('aria-checked', 'true')
    expect(cell('West', 'Hossein')).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText(/unsaved change/)).not.toBeInTheDocument()
  })

  it('an unlinked coordinator cannot be chosen and says why', async () => {
    const data = overview()
    data.coordinators[3] = { ...data.coordinators[3], linked: false }
    api.get.mockResolvedValue({ data })
    await ready()
    const farid = cell('Central', 'Farid')
    expect(farid).toHaveAttribute('aria-disabled', 'true')
    expect(farid).toHaveAccessibleDescription(/Link it on the KPI mapping page first/)
    await userEvent.click(farid)
    expect(farid).toHaveAttribute('aria-checked', 'false')
  })
})

describe('Update and Revert', () => {
  it('saves every changed region in one request and offers Revert', async () => {
    api.put.mockResolvedValue({ data: { ...overview({ Central: ZOHREH, West: FARID }), change_id: 'abc' } })
    api.post.mockResolvedValue({ data: overview() })
    await ready()
    await userEvent.click(cell('Central', 'Zohreh'))
    await userEvent.click(cell('West', 'Farid'))
    await userEvent.click(updateButton())

    expect(api.put).toHaveBeenCalledTimes(1)
    expect(api.put).toHaveBeenCalledWith('/admin/province-assignments', { changes: [
      { cra_region: 'Central', coordinator_user_id: ZOHREH, expected_coordinator_user_id: HOSSEIN },
      { cra_region: 'West', coordinator_user_id: FARID, expected_coordinator_user_id: HOSSEIN },
    ] })
    expect(await screen.findByText('2 regions updated across UEP')).toBeInTheDocument()
    expect(within(row('Central')).getByRole('img', { name: 'Saved' })).toBeInTheDocument()
    expect(row('Central')).not.toHaveClass('is-edited')

    await userEvent.click(screen.getByRole('button', { name: 'Revert' }))
    expect(api.post).toHaveBeenCalledWith('/admin/province-assignments/revert/abc')
    expect(await screen.findByText('Previous coordinators restored')).toBeInTheDocument()
    expect(cell('Central', 'Hossein')).toHaveAttribute('aria-checked', 'true')
  })

  it('a save error shows the reason and keeps the edits', async () => {
    api.put.mockRejectedValue({ response: { status: 422, data: { detail: 'That user is not an active Coordinator' } } })
    await ready()
    await userEvent.click(cell('Central', 'Zohreh'))
    await userEvent.click(updateButton())
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't update: That user is not an active Coordinator")
    expect(cell('Central', 'Zohreh')).toHaveAttribute('aria-checked', 'true')
  })

  it('a 409 reloads, keeps the edits that are still valid and says which', async () => {
    api.put.mockRejectedValue({ response: { status: 409, data: { detail: { stale: { North: FARID } } } } })
    await ready()
    await userEvent.click(cell('Central', 'Zohreh'))
    await userEvent.click(cell('North', 'Zohreh'))
    api.get.mockResolvedValue({ data: overview({ North: FARID }) })
    await userEvent.click(updateButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Assignments changed since you opened the page. Your edits to Central were kept; others were refreshed.')
    expect(cell('Central', 'Zohreh')).toHaveAttribute('aria-checked', 'true')
    expect(cell('North', 'Farid')).toHaveAttribute('aria-checked', 'true')
    expect(updateButton()).toHaveTextContent('Update 1')
  })
})

describe('History', () => {
  it('opens a drawer with the timeline and closes with Esc, focus back on History', async () => {
    await ready()
    const history = screen.getByRole('button', { name: 'History' })
    await userEvent.click(history)
    const drawer = await screen.findByRole('dialog', { name: 'Assignment history' })
    expect(await within(drawer).findByText('Central (5 provinces): Hossein → Zohreh')).toBeInTheDocument()
    expect(within(drawer).getByText('Azar (3 provinces): Hossein')).toBeInTheDocument()
    expect(within(drawer).getByText('Current')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(history).toHaveFocus()
  })

  it('closes on a click on the scrim', async () => {
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'History' }))
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByTestId('history-scrim'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('keyboard', () => {
  it('← → move the owner within the row; ↑ ↓ move to the next region', async () => {
    await ready()
    const hossein = cell('Central', 'Hossein')
    act(() => hossein.focus())
    fireEvent.keyDown(hossein, { key: 'ArrowRight' })
    expect(cell('Central', 'Amir')).toHaveAttribute('aria-checked', 'true')
    expect(cell('Central', 'Amir')).toHaveFocus()
    fireEvent.keyDown(cell('Central', 'Amir'), { key: 'ArrowLeft' })
    expect(cell('Central', 'Hossein')).toHaveAttribute('aria-checked', 'true')

    fireEvent.keyDown(cell('Central', 'Hossein'), { key: 'ArrowDown' })
    expect(cell('North', 'Amir')).toHaveFocus()
    fireEvent.keyDown(cell('North', 'Amir'), { key: 'ArrowUp' })
    expect(cell('Central', 'Hossein')).toHaveFocus()
  })
})

describe('Viewer', () => {
  it('sees the owners only, no Update or Discard, and the view-only footer', async () => {
    auth.user = { id: 2, role: { name: 'Viewer' } }
    await ready()
    expect(screen.getByText('View only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Update/ })).not.toBeInTheDocument()
    expect(document.querySelector('.pa-empty')).toBeNull()
    expect(screen.getByText('You can view assignments. Only PM and Admin can change them.')).toBeInTheDocument()
    expect(row('Central')).toHaveAttribute('aria-readonly', 'true')

    await userEvent.click(cell('Central', 'Zohreh'))
    fireEvent.keyDown(cell('Central', 'Hossein'), { key: 'ArrowRight' })
    expect(cell('Central', 'Hossein')).toHaveAttribute('aria-checked', 'true')
  })
})

describe('states', () => {
  it('shows a skeleton while loading', async () => {
    api.get.mockReturnValue(new Promise(() => {}))
    renderPage()
    const skeleton = screen.getByLabelText('Loading province assignments')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(skeleton.querySelectorAll('.pa-skel-avatar')).toHaveLength(4)
    expect(skeleton.querySelectorAll('.pa-row:not(.pa-head-row)')).toHaveLength(6)
  })

  it('a load error offers Retry', async () => {
    api.get.mockRejectedValueOnce(new Error('down'))
    renderPage()
    expect(await screen.findByText("Couldn't load province assignments")).toBeInTheDocument()
    expect(screen.getByText("The server didn't answer. Nothing was changed. Try again in a moment.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('radiogroup', { name: 'Coordinator for Central' })).toBeInTheDocument()
  })

  it('with no coordinator accounts, links an admin to Users & roles', async () => {
    auth.user = { id: 1, role: { name: 'Admin' } }
    auth.isAdmin = true
    api.get.mockResolvedValue({ data: { ...overview(), coordinators: [] } })
    renderPage()
    expect(await screen.findByText('No coordinator accounts yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Users & roles' })).toHaveAttribute('href', '/admin?tab=users')
  })
})

describe('copy', () => {
  it('words a history line and the 409 message', () => {
    expect(historyLine({ cra_region: 'Central', provinces: 5, old: 'Hossein', new: 'Zohreh' }))
      .toBe('Central (5 provinces): Hossein → Zohreh')
    expect(conflictText([])).toBe('Assignments changed since you opened the page. The latest values are loaded.')
  })
})
