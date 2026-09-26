import { render } from '@testing-library/react'
import BrandMark from './BrandMark'

describe('BrandMark', () => {
  it('is decorative: hidden from assistive technology and not focusable', () => {
    const { container } = render(<BrandMark />)
    const svg = container.querySelector('svg.brand-mark')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
  })

  it('draws the signal symbol, not the old "U" letter', () => {
    const { container } = render(<BrandMark />)
    expect(container.querySelector('circle')).toHaveAttribute('cx', '9.5')
    expect(container.querySelectorAll('path')).toHaveLength(2)
    expect(container).not.toHaveTextContent('U')
  })
})
