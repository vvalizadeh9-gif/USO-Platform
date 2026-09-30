import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import WaffleTile from './WaffleTile'

function draw(props = {}) {
  const onOpen = vi.fn()
  const onFigure = vi.fn()
  render(
    <WaffleTile
      authority="CRA"
      label="Pending"
      filled={13}
      figure={
        <button type="button" onClick={onFigure}>
          575
        </button>
      }
      share="13% of 4,433 drive-tested"
      scale="1 square ≈ 44 villages"
      openLabel="CRA Pending: 575 villages — see who is holding it"
      onOpen={onOpen}
      {...props}
    />
  )
  return { onOpen, onFigure }
}

describe('WaffleTile', () => {
  it('fills the given squares of 100 and says what a square is', () => {
    draw()
    const grid = document.querySelector('.waffle-tile-grid')
    expect(grid.querySelectorAll('i')).toHaveLength(100)
    expect(grid.querySelectorAll('i.on')).toHaveLength(13)
    expect(grid).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('1 square ≈ 44 villages')).toBeInTheDocument()
    expect(screen.getByText('13% of 4,433 drive-tested')).toBeInTheDocument()
  })

  it('always carries the authority chip', () => {
    draw()
    expect(screen.getByText('CRA')).toHaveAttribute('data-authority', 'cra')
  })

  it('opens on a tile click', async () => {
    const { onOpen, onFigure } = draw()
    await userEvent.click(screen.getByRole('button', { name: /see who is holding it/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onFigure).not.toHaveBeenCalled()
  })

  it('exports on a figure click, without opening', async () => {
    const { onOpen, onFigure } = draw()
    await userEvent.click(screen.getByRole('button', { name: '575' }))
    expect(onFigure).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('never nests the figure button inside the tile button', () => {
    draw()
    const hit = screen.getByRole('button', { name: /see who is holding it/ })
    expect(hit.querySelector('button')).toBeNull()
    expect(hit.childElementCount).toBe(0)
  })

  it('shows the selected state while what it opened is open', () => {
    draw({ selected: true })
    expect(screen.getByTestId('waffle-tile')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByRole('button', { name: /see who is holding it/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('adds a breakdown line under the scale when given one', () => {
    draw({ breakdown: 'In Mojri 3,472 · Needs a look 0 · Missing 403' })
    expect(screen.getByTestId('waffle-breakdown')).toHaveTextContent(
      'In Mojri 3,472 · Needs a look 0 · Missing 403'
    )
  })

  it('draws no breakdown line when none is given', () => {
    draw()
    expect(screen.queryByTestId('waffle-breakdown')).not.toBeInTheDocument()
  })

  it('draws an empty dotted grid and a dash when there is no data yet', () => {
    draw({ empty: true, emptyNote: 'No Mojri import yet', emptyFigure: '3,838 approved in UEP' })
    expect(document.querySelector('.waffle[data-empty]')).not.toBeNull()
    expect(document.querySelectorAll('.waffle i.on')).toHaveLength(0)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('No Mojri import yet')).toBeInTheDocument()
    expect(screen.getByText('3,838 approved in UEP')).toBeInTheDocument()
    expect(screen.queryByText('1 square ≈ 44 villages')).not.toBeInTheDocument()
  })
})
