import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ItemDots from './ItemDots'
import { DOTS_MAX, dotsLabel } from '../lib/itemDots'

describe('the dot rule', () => {
  it('draws one dot per item up to 30', () => {
    render(<ItemDots onTime={20} dueSoon={6} late={4} />)
    const dots = screen.getByTestId('item-dots')
    expect(dots.querySelectorAll('i')).toHaveLength(DOTS_MAX)
    expect(dots.querySelectorAll('i.late')).toHaveLength(4)
    expect(dots.querySelectorAll('i.due-soon')).toHaveLength(6)
    expect(screen.queryByTestId('item-bar')).toBeNull()
  })

  it('switches to one proportional bar at 31', () => {
    render(<ItemDots onTime={21} dueSoon={6} late={4} />)
    const bar = screen.getByTestId('item-bar')
    expect(screen.queryByTestId('item-dots')).toBeNull()
    expect([...bar.querySelectorAll('i')].map((i) => i.style.flexGrow)).toEqual(['21', '6', '4'])
  })

  it('leaves out empty segments of the bar', () => {
    render(<ItemDots onTime={224} late={0} />)
    expect(screen.getByTestId('item-bar').querySelectorAll('i')).toHaveLength(1)
  })

  it('is hidden from screen readers, which read the row label instead', () => {
    render(<ItemDots onTime={2} late={1} />)
    expect(screen.getByTestId('item-dots')).toHaveAttribute('aria-hidden', 'true')
    expect(dotsLabel({ onTime: 2, dueSoon: 0, late: 1 })).toBe('3 items: 2 on time, 0 due soon, 1 late')
  })

  it('draws nothing for nothing', () => {
    const { container } = render(<ItemDots />)
    expect(container).toBeEmptyDOMElement()
  })
})
