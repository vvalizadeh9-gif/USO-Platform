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
  Modal,
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
  it('renders the icon chip in its tone, the title, the description, actions and body', () => {
    const { container } = render(
      <Card
        icon={Users}
        tone="support"
        title="Stopped before CRA"
        description="Who is behind the selected barrier"
        actions={<button type="button">Export</button>}
      >
        <p>Body</p>
      </Card>
    )
    expect(container.querySelector('.ui-card-chip')).toHaveClass('ui-chip-support')
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
