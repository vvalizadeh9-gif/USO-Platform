// The shared Cobalt components: what each one renders, which option it says is
// selected, and the keyboard contract (arrows for Tabs and SegmentedControl;
// Escape, focus trap and focus return for Modal and Drawer).
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Users } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import {
  Banner,
  Card,
  ConfirmDialog,
  Drawer,
  KpiCard,
  Meter,
  Modal,
  PageBar,
  PageHead,
  SegmentedControl,
  StatusPill,
  Tabs,
} from './ui'

const TABS = [
  { key: 'road', label: 'The road' },
  { key: 'map', label: 'Coverage map' },
  { key: 'history', label: 'History' },
]

function TabsHarness({ initial = 'road' }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <Tabs tabs={TABS} value={value} onChange={setValue} label="Gap views" />
      <output data-testid="value">{value}</output>
    </>
  )
}

const LENSES = [
  { key: 'province', label: 'Province' },
  { key: 'rm', label: 'Manager' },
  { key: 'coordinator', label: 'Coordinator' },
]

function SegHarness() {
  const [value, setValue] = useState('province')
  return (
    <>
      <SegmentedControl options={LENSES} value={value} onChange={setValue} label="Lens" />
      <output data-testid="value">{value}</output>
    </>
  )
}

describe('PageHead', () => {
  it('renders the eyebrow, the title as the page heading, the subtitle and actions', () => {
    render(
      <PageHead
        eyebrow="Performance"
        title="Lifecycle Gaps"
        subtitle="Last CPM import"
        actions={<button type="button">Export</button>}
      />
    )
    expect(screen.getByText('Performance')).toHaveClass('eyebrow')
    expect(screen.getByRole('heading', { level: 1, name: 'Lifecycle Gaps' })).toBeInTheDocument()
    expect(screen.getByText('Last CPM import')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
  })
})

describe('Tabs', () => {
  it('renders a named tablist with the selected tab marked and alone in the Tab order', () => {
    render(<TabsHarness />)
    expect(screen.getByRole('tablist', { name: 'Gap views' })).toBeInTheDocument()
    const road = screen.getByRole('tab', { name: 'The road' })
    const map = screen.getByRole('tab', { name: 'Coverage map' })
    expect(road).toHaveAttribute('aria-selected', 'true')
    expect(road).toHaveAttribute('tabindex', '0')
    expect(map).toHaveAttribute('aria-selected', 'false')
    expect(map).toHaveAttribute('tabindex', '-1')
  })

  it('selects on click', async () => {
    render(<TabsHarness />)
    await userEvent.click(screen.getByRole('tab', { name: 'Coverage map' }))
    expect(screen.getByRole('tab', { name: 'Coverage map' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('value')).toHaveTextContent('map')
  })

  it('moves and selects with the arrow keys, wrapping at both ends, and Home/End', async () => {
    render(<TabsHarness />)
    screen.getByRole('tab', { name: 'The road' }).focus()

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Coverage map' })).toHaveFocus()
    expect(screen.getByTestId('value')).toHaveTextContent('map')

    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'History' })).toHaveFocus()
    expect(screen.getByTestId('value')).toHaveTextContent('history')

    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'The road' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByTestId('value')).toHaveTextContent('history')
  })
})

describe('SegmentedControl', () => {
  it('is a named group of buttons exposing aria-pressed', () => {
    render(<SegHarness />)
    expect(screen.getByRole('group', { name: 'Lens' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Province' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Manager' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('changes the choice on click', async () => {
    render(<SegHarness />)
    await userEvent.click(screen.getByRole('button', { name: 'Coordinator' }))
    expect(screen.getByRole('button', { name: 'Coordinator' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Province' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('moves the choice with the arrow keys and wraps', async () => {
    render(<SegHarness />)
    screen.getByRole('button', { name: 'Province' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: 'Manager' })).toHaveFocus()
    expect(screen.getByTestId('value')).toHaveTextContent('rm')
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByRole('button', { name: 'Coordinator' })).toHaveFocus()
    expect(screen.getByTestId('value')).toHaveTextContent('coordinator')
  })
})

describe('Card', () => {
  it('renders the icon chip, the title, the description, actions and body', () => {
    const { container } = render(
      <Card
        icon={Users}
        title="Stopped before CRA"
        description="Who is behind the selected barrier"
        actions={<button type="button">Export</button>}
      >
        <p>Body</p>
      </Card>
    )
    // Neutral: one class, no tone. Cobalt is for selection, not decoration.
    expect(container.querySelector('.ui-card-chip')).toHaveAttribute('class', 'ui-card-chip')
    expect(container.querySelector('.ui-card-chip')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('heading', { level: 2, name: 'Stopped before CRA' })).toBeInTheDocument()
    expect(screen.getByText('Who is behind the selected barrier')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
  })

  it('draws no header when given none', () => {
    const { container } = render(<Card>Only a body</Card>)
    expect(container.querySelector('.ui-card-head')).toBeNull()
  })
})

describe('Banner', () => {
  it.each([
    ['info', 'note'],
    ['warning', 'note'],
    ['success', 'note'],
    ['error', 'alert'],
  ])('renders the %s tone as a %s', (tone, role) => {
    render(<Banner tone={tone} title="Heads up.">Some text</Banner>)
    const banner = screen.getByRole(role)
    expect(banner).toHaveClass(`banner-${tone}`)
    expect(banner).toHaveTextContent('Heads up. Some text')
  })
})

describe('StatusPill', () => {
  it('keeps the status-to-colour mapping and always shows the word', () => {
    const { rerender } = render(<StatusPill status="Approved" />)
    expect(screen.getByText('Approved')).toHaveClass('pill', 'pill-green')
    rerender(<StatusPill status="Problematic" />)
    expect(screen.getByText('Problematic')).toHaveClass('pill-red')
    rerender(<StatusPill status="Something new" />)
    expect(screen.getByText('Something new')).toHaveClass('pill-dim')
    rerender(<StatusPill status={null} />)
    expect(screen.getByText('—')).toHaveClass('pill-dim')
  })
})

function DialogHarness({ Shell }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <Shell open={open} onClose={() => setOpen(false)} title="Settings">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Shell>
    </>
  )
}

describe.each([
  ['Modal', Modal],
  ['Drawer', Drawer],
])('%s', (_name, Shell) => {
  it('is a named modal dialog that takes focus when it opens', async () => {
    render(<DialogHarness Shell={Shell} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus()
  })

  it('keeps Tab inside the panel', async () => {
    render(<DialogHarness Shell={Shell} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
  })

  it('closes on Escape and gives focus back to what opened it', async () => {
    render(<DialogHarness Shell={Shell} />)
    const opener = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(opener)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('closes on a backdrop click', async () => {
    const { container } = render(<DialogHarness Shell={Shell} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.click(container.querySelector('.scrim'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('ConfirmDialog', () => {
  const props = {
    open: true,
    title: 'Mark problematic?',
    message: 'The site leaves the queue.',
    confirmLabel: 'Mark problematic',
  }

  it('renders nothing when closed', () => {
    render(<ConfirmDialog {...props} open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sits in the Modal shell, confirms and cancels', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog {...props} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByRole('dialog', { name: 'Mark problematic?' })).toHaveClass('modal')
    expect(screen.getByText('The site leaves the queue.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mark problematic' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('cancels on Escape', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={onCancel} />)
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('uses the danger button for a dangerous action, and disables both while busy', () => {
    const { rerender } = render(<ConfirmDialog {...props} danger onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Mark problematic' })).toHaveClass('btn-danger')
    rerender(<ConfirmDialog {...props} danger busy onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})

// ------------------------------------------------------ Tabs: the full row
//
// The redesigned pages' tab rows: icons, a count chip, a late chip, steps
// with chevrons between them, a labelled group, and an end tab behind a
// divider -- and still one keyboard stop that arrows through every tab.
const PROCESS_TABS = [
  { key: 'pool', label: 'HC Pool', icon: Users, count: 1012 },
  { key: 'running', label: 'In Progress', count: 320, alert: '4 late' },
  { key: 'review', label: 'HC Review', count: 0 },
  { key: 'fix', label: 'Remediation', group: 'loop', count: 9 },
  { key: 'reroutes', label: 'Re-routes', group: 'loop' },
  { key: 'history', label: 'History', end: true },
]

function ProcessTabs() {
  const [value, setValue] = useState('pool')
  return (
    <Tabs
      steps
      label="Health check"
      tabs={PROCESS_TABS}
      groups={{ loop: { label: 'Fix loop', title: 'Fixed sites return to the pool' } }}
      value={value}
      onChange={setValue}
    />
  )
}

describe('Tabs: counts, groups and steps', () => {
  it('shows a count above zero, and the alert chip beside it', () => {
    render(<ProcessTabs />)
    expect(screen.getByRole('tab', { name: /HC Pool/ })).toHaveTextContent('1012')
    const running = screen.getByRole('tab', { name: /In Progress/ })
    expect(running.querySelector('.ui-tab-count')).toHaveTextContent('320')
    expect(running.querySelector('.ui-tab-alert')).toHaveTextContent('4 late')
    // A zero is no chip at all.
    expect(screen.getByRole('tab', { name: 'HC Review' }).querySelector('.ui-tab-count')).toBeNull()
  })

  it('draws a group under its label, and the end tab after a divider', () => {
    const { container } = render(<ProcessTabs />)
    const group = container.querySelector('.ui-tab-group')
    expect(group).toHaveTextContent('Fix loop')
    expect(group.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(container.querySelector('.ui-tab-end')).toHaveTextContent('History')
  })

  it('puts a chevron between the steps, but not inside the group or before the end', () => {
    const { container } = render(<ProcessTabs />)
    // pool › running › review › [group]: three chevrons.
    expect(container.querySelectorAll('.ui-tab-sep')).toHaveLength(3)
    expect(container.querySelector('.ui-tab-group .ui-tab-sep')).toBeNull()
  })

  it('arrows through every tab, the grouped and the end one included', async () => {
    const user = userEvent.setup()
    render(<ProcessTabs />)
    screen.getByRole('tab', { name: /HC Pool/ }).focus()
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'History' })).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Re-routes' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('tab', { name: /HC Pool/ })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('PageBar', () => {
  it('puts each slot in its place', () => {
    const { container } = render(
      <PageBar
        eyebrow="Drive Test"
        title="Dashboard"
        context={<span>scope</span>}
        actions={<button type="button">Export</button>}
        tabs={<Tabs tabs={TABS} value="road" onChange={() => {}} label="Views" />}
        tabsRight={<span>period</span>}
      />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(container.querySelector('.page-bar-eyebrow')).toHaveTextContent('Drive Test')
    expect(container.querySelector('.page-bar-context')).toHaveTextContent('scope')
    expect(container.querySelector('.page-bar-actions')).toContainElement(
      screen.getByRole('button', { name: 'Export' }),
    )
    expect(container.querySelector('.page-bar-tabs [role="tablist"]')).toBeInTheDocument()
    expect(container.querySelector('.page-bar-tabs-right')).toHaveTextContent('period')
  })

  it('leaves out the slots it is not given', () => {
    const { container } = render(<PageBar title="Monthly Plan" />)
    expect(container.querySelector('.page-bar-context')).toBeNull()
    expect(container.querySelector('.page-bar-actions')).toBeNull()
    expect(container.querySelector('.page-bar-tabs')).toBeNull()
  })
})

describe('KpiCard', () => {
  it('is a region named by its title, with the figure, its note and the badge', () => {
    render(
      <KpiCard icon={Users} title="MTN target" figure="345" aside="Edit" badge={<span>Internal</span>}>
        <span>floor</span>
      </KpiCard>,
    )
    const card = screen.getByRole('region', { name: 'MTN target' })
    expect(card.querySelector('.kpi-card-figure')).toHaveTextContent('345')
    expect(card.querySelector('.kpi-card-aside')).toHaveTextContent('Edit')
    expect(card.querySelector('.kpi-card-badge')).toHaveTextContent('Internal')
    expect(card.querySelector('.kpi-card-chip')).toHaveAttribute('aria-hidden', 'true')
    expect(card).toHaveTextContent('floor')
  })
})

describe('Meter', () => {
  it('caps the fill at the track and places the tick', () => {
    render(<Meter value={130} tick={40} label="Delivered 130%" />)
    const meter = screen.getByRole('img', { name: 'Delivered 130%' })
    expect(meter.querySelector('.meter-fill')).toHaveStyle({ width: '100%' })
    expect(screen.getByTestId('meter-tick')).toHaveStyle({ left: '40%' })
  })

  it('draws no tick without one, and hides itself without a label', () => {
    const { container } = render(<Meter value={20} />)
    expect(screen.queryByTestId('meter-tick')).toBeNull()
    expect(container.querySelector('.meter')).toHaveAttribute('aria-hidden', 'true')
  })
})
