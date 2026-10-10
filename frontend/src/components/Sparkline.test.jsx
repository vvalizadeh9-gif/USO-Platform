import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Sparkline, { describeSeries, segments } from './Sparkline'

describe('Sparkline', () => {
  it('splits the series into runs around missing days', () => {
    expect(segments([1, 2, null, null, 4, 5, null, 6])).toEqual([
      [[0, 1], [1, 2]],
      [[4, 4], [5, 5]],
      [[7, 6]],
    ])
  })

  it('draws a gap, not a zero, for a missing day', () => {
    const { container } = render(<Sparkline label="Overdue" values={[9, 8, null, 6, 5]} />)
    const lines = container.querySelectorAll('.sparkline-line')
    expect(lines).toHaveLength(2)
    // Nothing is drawn at the missing day's x (70 of 140).
    lines.forEach((line) => expect(line.getAttribute('d')).not.toMatch(/[ML]70 /))
  })

  it('says the range in words', () => {
    render(<Sparkline label="Overdue" values={[9, null, 7, 6, 5]} />)
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Overdue over the last 5 days, falling from 9 to 5',
    )
    expect(describeSeries('Waiting on you', [3, 4, 8])).toBe(
      'Waiting on you over the last 3 days, rising from 3 to 8',
    )
  })

  it('keeps a flat series in the middle and says it is steady', () => {
    const { container } = render(<Sparkline label="Due soon" values={[4, 4, 4]} />)
    expect(container.querySelector('.sparkline-line').getAttribute('d')).toBe('M0 16L70 16L140 16')
    expect(screen.getByRole('img')).toHaveAccessibleName('Due soon over the last 3 days, steady at 4')
  })

  it('says when there is nothing to draw yet', () => {
    const { container } = render(<Sparkline label="Done" values={[null, null, 2]} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('Done over the last 3 days: 2, no earlier data')
    expect(container.querySelectorAll('.sparkline-area')).toHaveLength(0)
    expect(describeSeries('Done', [null, null])).toBe('Done over the last 2 days: no data yet')
  })
})
