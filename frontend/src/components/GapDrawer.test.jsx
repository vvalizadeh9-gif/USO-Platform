import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import GapDrawer from './GapDrawer'

const LENSES = [
  { key: 'coordinator', label: 'Coordinator' },
  { key: 'contractor', label: 'Contractor' },
  { key: 'province', label: 'Province' },
]

const ROWS = [
  { name: 'V. Hashemi', count: 205, share: 14.7, marks: 3, attribution: 'owned', sub: 'RM Allahyar' },
  { name: 'Unknown province', count: 5, share: 0.4, marks: 0, attribution: 'unknown_province', note: 'No province' },
]

/** The drawer behind an opener, the way a page uses it. */
function Harness({ onLens = () => {}, ...props }) {
  const [open, setOpen] = useState(false)
  const [lens, setLens] = useState('coordinator')
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open tile
      </button>
      <GapDrawer
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Pending approval"
        authority="ICT"
        title="Pending ICT approval"
        hero={{ figure: '1,391', filled: 31, line: '31.4% of 4,433 drive-tested' }}
        lens={lens}
        lensOptions={LENSES}
        onLens={(next) => {
          setLens(next)
          onLens(next)
        }}
        rows={ROWS}
        summary="2 coordinators hold these 210 villages"
        shareNote="Share of gap = their pending ÷ 210"
        check={{ ok: true, text: 'Adds up to 210' }}
        {...props}
      />
    </>
  )
}

async function openDrawer(props) {
  render(<Harness {...props} />)
  const opener = screen.getByRole('button', { name: 'open tile' })
  await userEvent.click(opener)
  return { opener, dialog: screen.getByRole('dialog') }
}

describe('GapDrawer', () => {
  it('is a modal dialog named by its chip and title', async () => {
    const { dialog } = await openDrawer()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('ICT Pending ICT approval')
    expect(within(dialog).getByText('Pending approval')).toBeInTheDocument()
  })

  it('moves focus to Close on open and back to the opener on close', async () => {
    const { opener } = await openDrawer()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('keeps Tab inside the drawer', async () => {
    const { dialog } = await openDrawer()
    for (let i = 0; i < 8; i += 1) {
      await userEvent.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    await userEvent.tab({ shift: true })
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('closes on Esc and on the scrim', async () => {
    const { opener } = await openDrawer()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()

    await userEvent.click(opener)
    await userEvent.click(screen.getByTestId('gap-drawer-scrim'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('moves the Group-by choice with the arrow keys', async () => {
    const onLens = vi.fn()
    await openDrawer({ onLens })
    const group = screen.getByRole('group', { name: 'Group by' })
    within(group).getByRole('button', { name: 'Coordinator' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onLens).toHaveBeenLastCalledWith('contractor')
    expect(within(group).getByRole('button', { name: 'Contractor' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(onLens).toHaveBeenLastCalledWith('province')
  })

  it('hides Group by when there are no options to offer', async () => {
    await openDrawer({ lensOptions: null })
    expect(screen.queryByRole('group', { name: 'Group by' })).not.toBeInTheDocument()
  })

  it('lists every row with its mark, name, count, share and sub-line', async () => {
    const { dialog } = await openDrawer()
    const rows = within(dialog).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('V. HashemiRM Allahyar20514.7%')
    expect(rows[0].querySelectorAll('.waffle-size-mark i')).toHaveLength(20)
    expect(rows[0].querySelectorAll('.waffle-size-mark i.on')).toHaveLength(3)
    expect(rows[1]).toHaveClass('is-unowned')
    expect(rows[1]).toHaveTextContent('No province')
  })

  it('shows the tick when the rows add up', async () => {
    await openDrawer()
    const check = screen.getByTestId('gap-checksum')
    expect(check).toHaveTextContent('Adds up to 210 ✓')
    expect(check).not.toHaveClass('bad')
  })

  it('shows a warning, not a tick, when they do not', async () => {
    await openDrawer({ check: { ok: false, text: 'The rows add up to 210, not 250' } })
    const check = screen.getByTestId('gap-checksum')
    expect(check).toHaveClass('bad')
    expect(check).toHaveAttribute('role', 'alert')
    expect(check).not.toHaveTextContent('✓')
  })

  it('replaces the list with an empty state, keeping Group by', async () => {
    const { dialog } = await openDrawer({
      empty: { title: 'Nothing to compare yet.', hint: 'Once the Mojri tracker is imported…' },
    })
    expect(within(dialog).queryByRole('table')).not.toBeInTheDocument()
    expect(within(dialog).getByText('Nothing to compare yet.')).toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: 'Group by' })).toBeInTheDocument()
    expect(screen.queryByTestId('gap-checksum')).not.toBeInTheDocument()
  })

  it('marks the list busy while a new lens loads', async () => {
    await openDrawer({ loading: true })
    expect(document.querySelector('.gap-drawer-scroll')).toHaveAttribute('aria-busy', 'true')
  })
})
