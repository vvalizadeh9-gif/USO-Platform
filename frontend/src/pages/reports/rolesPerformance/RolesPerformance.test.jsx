// Roles Performance: what each role is offered, and the promises that fail
// quietly -- an old bookmark that drops the scope, a Month that sneaks a
// comparison back in, a column that does not add up, a denominator on Area,
// a ranking out of order, a sign flipped by bidi next to a Persian name.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../../context/ToastContext'

vi.mock('../../../api/client', () => ({ default: { get: vi.fn() } }))
vi.mock('../CoverageMap', () => ({ default: () => <div>coverage map</div> }))

const authUser = vi.hoisted(() => ({ current: { role: { name: 'PM' }, full_name: 'Pat PM' } }))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: authUser.current }),
}))

const api = (await import('../../../api/client')).default
const RolesPerformance = (await import('./RolesPerformance')).default

const month = (y, m, label) => ({ year: y, month: m, label_fa: label })
const owner = (name, now) => ({
  name, now, ref: 0, delta: now, lower_is_better: false, recorded: true, ref_recorded: true,
})
const row = (key, label, unit, now, over = {}) => ({
  key, label, unit, now, ref: 7, delta: now - 7, lower_is_better: false, recorded: true,
  ref_recorded: true, villages: null, owners: null,
  owners_by: {
    contractor: [owner('Alpha', Math.ceil(now / 2)), owner('Beta', Math.floor(now / 2)),
      owner('Gamma', 0)],
    rm: [owner('حسین', now - 1), owner('Karimi', 0), owner('Unattributed', 1)],
    coordinator: [owner('Amir', now)],
  },
  ...over,
})

const monthPayload = (params = {}) => {
  const shown = params.month === '1405-05' ? month(1405, 5, 'مرداد ۱۴۰۵') : month(1405, 6, 'شهریور ۱۴۰۵')
  const closedBefore = shown.month < 7
  return {
    month: shown,
    ref_month: month(1405, shown.month - 1, ''),
    running: false,
    day: null,
    days_in_month: 31,
    ref_day: 31,
    by: 'owners',
    recorded_from: month(1405, 7, 'مهر ۱۴۰۵'),
    current_month: month(1405, 7, 'مهر ۱۴۰۵'),
    first_year: 1404,
    undated_on_air: 0,
    last_cpm_import: null,
    sections: [
      { key: 'delivery', title: 'Project delivery', block: { value: 5, unit: 'sites' }, rows: [
        row('on_air', 'On air', 'sites', 12, { villages: { now: 30 } }),
        row('dt_done', 'DT done', 'sites', 10),
      ] },
      { key: 'acceptance', title: 'Acceptance', block: { value: 10, unit: 'villages' }, rows: [
        row('ict_approved', 'ICT approved', 'villages', 9),
        row('cra_approved', 'CRA approved', 'villages', 0),
        closedBefore && params.month === '1405-05'
          ? row('fully_approved', 'Fully approved', 'villages', null,
            { recorded: false, owners_by: null })
          : row('fully_approved', 'Fully approved', 'villages', 8),
      ] },
      { key: 'full_config', title: 'Full config', block: { value: 5, unit: 'sites' }, rows: [
        row('full_config', 'Became full config', 'sites', 4),
        row('fell_back', 'Fell back', 'sites', 3, { lower_is_better: true }),
      ] },
      { key: 'problematic', title: 'Problematic', block: { value: 5, unit: 'sites' }, rows: [
        row('problem_resolved', 'Resolved', 'sites', 2),
        row('problem_new', 'New problems', 'sites', 5, { lower_is_better: true }),
      ] },
    ],
  }
}

const m = (count, rate) => ({ count, rate })
const areaRow = (name, full, low = false) => ({
  name, gaps_key: name, villages: 100, low_sample: low,
  measures: { onair: m(90, 90), dt: m(80, 80), full: m(full, full), ict: m(60, 75), cra: m(50, 62.5) },
})
const areaPayload = (params = {}) => {
  const scoped = Boolean(params.lens)
  return {
    scope: scoped
      ? { lens: params.lens, key: params.key, label: params.key, chip: '6 provinces',
        selectable: true, past: false, provinces: 6, cra_regions: 2 }
      : { lens: 'country', key: 'Whole country', label: 'Whole country', chip: '31 provinces',
        selectable: true, past: false, provinces: 31, cra_regions: 9 },
    as_of: '2026-10-01T08:00:00Z',
    read_only: false,
    totals: {
      villages: 5210, onair: m(4742, 91), dt: m(4428, 85), full: m(2657, 51),
      ict: m(3188, 72), cra: m(3100, 70),
    },
    national: { onair: 88, dt: 85, full: 51, ict: 72, cra: 70 },
    breakdown: params.breakdown ?? 'province',
    breakdowns: ['province', 'region', 'contractor', 'coordinator', 'rm'],
    rows: [areaRow('Yazd', 60), areaRow('Qom', 40), areaRow('Ilam', 40), areaRow('Zanjan', 10, true),
      areaRow('Fars', 51)],
    low_sample_threshold: 10,
  }
}

function respond(routes) {
  api.get.mockImplementation((path, config) => {
    const handler = routes[path]
    if (!handler) return Promise.resolve({ data: { options: {}, past: {}, labels: {} } })
    return Promise.resolve({ data: typeof handler === 'function' ? handler(config?.params ?? {}) : handler })
  })
}

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.search}</output>
}

function renderAt(path, role, name = 'Pat Person') {
  authUser.current = { role: { name: role }, full_name: name }
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/reports/kpi" element={<RolesPerformance />} />
          <Route path="/reports/kpi/:tab" element={<><RolesPerformance /><Where /></>} />
          <Route path="/reports/gaps" element={<Where />} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

const where = () => screen.getByTestId('where').textContent
const tabNames = () =>
  within(screen.getByRole('tablist', { name: 'Roles performance views' }))
    .getAllByRole('tab').map((t) => t.textContent)

beforeEach(() => {
  api.get.mockReset()
  respond({ '/kpi/month': monthPayload, '/kpi/area': areaPayload })
})

describe('tabs and landing per role', () => {
  it.each(['PM', 'Viewer'])('%s gets Month, Area, Map and lands on Month', async (role) => {
    renderAt('/reports/kpi', role)
    await waitFor(() => expect(tabNames()).toEqual(['Month', 'Area', 'Map']))
    expect(screen.getByRole('tab', { name: 'Month' })).toHaveAttribute('aria-selected', 'true')
  })

  it.each(['RegionalManager', 'Coordinator', 'Contractor'])('%s lands on My area', async (role) => {
    renderAt('/reports/kpi', role)
    await waitFor(() => expect(tabNames()).toEqual(['My area', 'Map']))
    expect(screen.getByRole('tab', { name: 'My area' })).toHaveAttribute('aria-selected', 'true')
  })

  it.each(['performance', 'compare'])('redirects an old /%s link, keeping the scope', async (old) => {
    renderAt(`/reports/kpi/${old}?lens=rm&key=Nobakht`, 'PM')
    await waitFor(() => expect(where()).toBe('/reports/kpi/month?lens=rm&key=Nobakht'))
    renderAt(`/reports/kpi/${old}?lens=rm&key=Nobakht`, 'RegionalManager')
    await waitFor(() =>
      expect(screen.getAllByTestId('where').at(-1).textContent)
        .toBe('/reports/kpi/area?lens=rm&key=Nobakht'))
  })

  it('sends a confined role asking for Month to their own landing', async () => {
    renderAt('/reports/kpi/month', 'Coordinator')
    await waitFor(() => expect(where()).toBe('/reports/kpi/area'))
    expect(api.get).not.toHaveBeenCalledWith('/kpi/month', expect.anything())
  })

  it('shows a confined role their name and scope chip, not a picker', async () => {
    respond({ '/kpi/area': () => ({ ...areaPayload(), scope: { ...areaPayload().scope, lens: 'rm',
      key: 'Nobakht', label: 'Nobakht', chip: '6 provinces · 2 CRA regions', selectable: false } }) })
    renderAt('/reports/kpi/area', 'RegionalManager', 'Reza Nobakht')
    expect(await screen.findByRole('heading', { name: /Reza Nobakht/ })).toBeInTheDocument()
    expect(await screen.findByText('6 provinces · 2 CRA regions')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Whose figures' })).toBeNull()
    expect(screen.queryByText(/Roles Performance ·/)).toBeNull()
  })

  it('sends Admin home', async () => {
    renderAt('/reports/kpi', 'Admin')
    expect(await screen.findByText('home')).toBeInTheDocument()
  })
})

describe('Month', () => {
  const measures = () => screen.getByRole('region', { name: 'Measures' })
  const pressed = () => within(measures()).getAllByRole('button', { pressed: true })

  it('asks for the three owner lists at once and opens on Fully approved', async () => {
    renderAt('/reports/kpi/month', 'PM')
    await screen.findByRole('button', { name: /Choose month/ })
    expect(api.get).toHaveBeenCalledWith('/kpi/month', { params: { by: 'owners' } })
    expect(pressed().map((b) => b.dataset.measure)).toEqual(['fully_approved'])
    expect(screen.getByRole('heading', { name: 'Fully approved' })).toBeInTheDocument()
    expect(screen.getByText('Whole month')).toBeInTheDocument()
  })

  it('respects ?measure= and keeps the choice in the URL', async () => {
    const user = userEvent.setup()
    renderAt('/reports/kpi/month?measure=dt_done', 'PM')
    await screen.findByRole('heading', { name: 'DT done' })
    await user.click(within(measures()).getByRole('button', { name: /New problems/ }))
    expect(where()).toContain('measure=problem_new')
    expect(pressed()).toHaveLength(1)
  })

  it('always shows three columns, each adding up to the total', async () => {
    renderAt('/reports/kpi/month', 'PM')
    const columns = await screen.findAllByRole('region', { name: /Contractors|Regional managers|Coordinators/ })
    expect(columns.map((c) => c.getAttribute('aria-label')))
      .toEqual(['Contractors', 'Regional managers', 'Coordinators'])
    for (const column of columns) {
      const counts = [...column.querySelectorAll('.rp-owner-count')].map((n) => Number(n.textContent))
      expect(counts.reduce((a, b) => a + b, 0)).toBe(8)
    }
  })

  it('colours only the top two owners, Unattributed last and hatched', async () => {
    renderAt('/reports/kpi/month', 'PM')
    const rm = await screen.findByRole('region', { name: 'Regional managers' })
    expect([...rm.querySelectorAll('.rp-swatch')].map((s) => s.dataset.rank)).toEqual(['1', 'none'])
    const contractors = screen.getByRole('region', { name: 'Contractors' })
    expect([...contractors.querySelectorAll('.rp-strip-seg')].map((s) => s.dataset.rank))
      .toEqual(['1', '2'])
    expect(within(rm).queryByRole('button', { name: /Unattributed/ })).toBeNull()
  })

  it('uses slate, not the accent, where fewer is better', async () => {
    const first = renderAt('/reports/kpi/month?measure=fell_back', 'PM')
    const contractors = await screen.findByRole('region', { name: 'Contractors' })
    expect(contractors).toHaveClass('rp-fewer')
    first.unmount()
    renderAt('/reports/kpi/month?measure=dt_done', 'PM')
    const other = await screen.findByRole('region', { name: 'Contractors' })
    expect(other).not.toHaveClass('rp-fewer')
  })

  it('collapses owners with none into one line', async () => {
    renderAt('/reports/kpi/month', 'PM')
    const contractors = await screen.findByRole('region', { name: 'Contractors' })
    expect(within(contractors).queryByText('Gamma')).toBeNull()
    expect(within(contractors).getByText('1 with none this month')).toHaveAttribute('title', 'Gamma')
  })

  it('opens an owner in Area scoped to them', async () => {
    const user = userEvent.setup()
    renderAt('/reports/kpi/month', 'PM')
    const contractors = await screen.findByRole('region', { name: 'Contractors' })
    await user.click(within(contractors).getByRole('button', { name: /Alpha/ }))
    await waitFor(() => expect(where()).toBe('/reports/kpi/area?lens=contractor&key=Alpha'))
  })

  it('shows no delta and no previous-month text anywhere', async () => {
    renderAt('/reports/kpi/month', 'PM')
    await screen.findByRole('region', { name: 'Contractors' })
    const page = document.querySelector('.rp').textContent
    expect(page).not.toMatch(/last month|compared with|[+−]\d/)
    expect(document.querySelector('.rp-delta')).toBeNull()
  })

  it('keeps numbers in their own LTR span, apart from RTL names', async () => {
    renderAt('/reports/kpi/month', 'PM')
    const name = await screen.findByText('حسین')
    expect(name).toHaveAttribute('dir', 'auto')
    const value = within(name.closest('button')).getByText('7')
    expect(value).toHaveAttribute('dir', 'ltr')
    expect(value.contains(name) || name.contains(value)).toBe(false)
  })

  it('opens the picker from the title: future months off, This month so far works', async () => {
    const user = userEvent.setup()
    renderAt('/reports/kpi/month', 'PM')
    const title = await screen.findByRole('button', { name: /Choose month/ })
    await user.click(title)
    const dialog = screen.getByRole('dialog', { name: 'Choose month' })
    expect(within(dialog).getByRole('button', { name: /آبان/ })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: /مهر/ })).toHaveTextContent('so far')
    expect(within(dialog).getByRole('button', { name: 'Next year' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'This month so far' }))
    expect(where()).toContain('month=1405-07')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the picker on Escape and gives focus back to the title', async () => {
    const user = userEvent.setup()
    renderAt('/reports/kpi/month', 'PM')
    const title = await screen.findByRole('button', { name: /Choose month/ })
    await user.click(title)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(title).toHaveFocus()
  })

  it('says when a month was not recorded', async () => {
    renderAt('/reports/kpi/month?month=1405-05', 'PM')
    expect(await screen.findByText(/Not recorded\. UEP has recorded this since/)).toBeInTheDocument()
    expect(within(measures()).getByRole('button', { name: /Fully approved/ }))
      .toHaveTextContent('Not recorded')
  })

  it('says when there was nothing', async () => {
    renderAt('/reports/kpi/month?measure=cra_approved', 'PM')
    expect(await screen.findByText('Nothing this month.')).toBeInTheDocument()
  })

  it('opens on the server default month (the last closed one)', async () => {
    renderAt('/reports/kpi/month', 'PM')
    expect(await screen.findByRole('button', { name: /Choose month, شهریور ۱۴۰۵ shown/ }))
      .toBeInTheDocument()
    expect(api.get.mock.calls.find(([p]) => p === '/kpi/month')[1].params.month).toBeUndefined()
  })
})

describe('Area', () => {
  const pipeline = () => screen.getByRole('region', { name: 'Pipeline' })

  it('lists the pipeline in order, Total villages not a choice, no denominators', async () => {
    renderAt('/reports/kpi/area', 'PM')
    await screen.findByRole('heading', { name: 'Fully approved by province' })
    const rows = [...pipeline().querySelectorAll('.rp-mrow')].map((r) => r.dataset.measure)
    expect(rows).toEqual(['villages', 'onair', 'dt', 'full', 'ict', 'cra'])
    expect(pipeline().querySelector('[data-measure="villages"]').tagName).toBe('DIV')
    expect(within(pipeline()).getByRole('button', { name: /Fully approved/ }))
      .toHaveAttribute('aria-pressed', 'true')
    // No denominators ("of 5,210") on either side; the ranking has no counts.
    expect(pipeline().textContent).not.toMatch(/\bof\b/)
    expect(document.querySelector('.rp-rank-list').textContent).not.toMatch(/\bof\b|villages:/)
  })

  it('shows the gap to national only when scoped', async () => {
    const first = renderAt('/reports/kpi/area', 'PM')
    await screen.findByRole('heading', { name: 'Fully approved by province' })
    expect(pipeline().querySelector('.rp-gap')).toBeNull()

    first.unmount()
    renderAt('/reports/kpi/area?lens=rm&key=Nobakht', 'PM')
    await screen.findByRole('heading', { name: 'Fully approved by province' })
    const scoped = pipeline()
    await waitFor(() => expect(scoped.querySelector('[data-measure="onair"] .rp-gap'))
      .toHaveTextContent('+3 pts'))
    expect(scoped.querySelector('[data-measure="full"] .rp-gap')).toHaveTextContent('±0')
  })

  it('ranks by gap with the national row pinned, Not compared last', async () => {
    renderAt('/reports/kpi/area', 'PM')
    await screen.findByRole('heading', { name: 'Fully approved by province' })
    const names = [...document.querySelectorAll('.rp-rank-row .rp-rank-name')].map((n) => n.textContent)
    expect(names).toEqual(['National average', 'Ilam', 'Qom', 'Fars', 'Yazd', 'Zanjan'])
    expect(screen.getByText(/Not compared · fewer than 10 DT-done villages/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Qom 40%, national 51%, 11 points behind' }))
      .toBeInTheDocument()
    expect(screen.getAllByText('−11 pts')).toHaveLength(2)
    expect(document.querySelector('.rp-behind')).toHaveTextContent('2 of 4 provinces')
  })

  it('opens a row in Lifecycle Gaps; the national row is not a link', async () => {
    const user = userEvent.setup()
    renderAt('/reports/kpi/area', 'PM')
    await screen.findByRole('heading', { name: 'Fully approved by province' })
    expect(document.querySelector('.rp-rank-national a')).toBeNull()
    await user.click(screen.getByRole('link', { name: /^Qom/ }))
    await waitFor(() => expect(where()).toBe('/reports/gaps?lens=province&key=Qom'))
  })

  it('offers the breakdowns the server allows, and asks for the one chosen', async () => {
    const user = userEvent.setup()
    respond({ '/kpi/area': (p) => ({ ...areaPayload(p), breakdowns: ['province', 'region'] }) })
    renderAt('/reports/kpi/area', 'Contractor')
    const control = await screen.findByRole('group', { name: 'Breakdown' })
    expect(within(control).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['Provinces', 'CRA regions'])
    await user.click(within(control).getByRole('button', { name: 'CRA regions' }))
    expect(api.get).toHaveBeenLastCalledWith('/kpi/area', { params: { breakdown: 'region' } })
    expect(await screen.findByRole('heading', { name: 'Fully approved by CRA region' }))
      .toBeInTheDocument()
  })

  it('changes the ranking with the measure, without a refetch', async () => {
    const user = userEvent.setup()
    renderAt('/reports/kpi/area', 'PM')
    await screen.findByRole('heading', { name: 'Fully approved by province' })
    const calls = api.get.mock.calls.length
    await user.click(within(pipeline()).getByRole('button', { name: /ICT approved/ }))
    expect(screen.getByRole('heading', { name: 'ICT approved by province' })).toBeInTheDocument()
    expect(within(pipeline()).getByRole('button', { name: /ICT approved/ })).toHaveFocus()
    expect(api.get.mock.calls.length).toBe(calls)
  })
})

describe('Map', () => {
  it('embeds the coverage map unchanged', async () => {
    renderAt('/reports/kpi/map', 'Contractor')
    expect(await screen.findByText('coverage map')).toBeInTheDocument()
  })
})
