import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Icon from './Icon'
import { ICONS, glyphFor } from './icons'

// The purposes in docs/design-system.md, each mapped to its Carbon glyph.
const SPEC_MAPPING = [
  'home', 'task', 'cell-tower', 'certificate--check', 'calendar', 'chart--column',
  'data--base', 'settings', 'switcher', 'search', 'notification', 'chevron--down',
  'chevron--right', 'arrow--left', 'user', 'password', 'login', 'view', 'view--off',
]

describe('Icon', () => {
  it.each(SPEC_MAPPING)('has the %s glyph at both sizes', (name) => {
    expect(ICONS[name][16].name).toBe(name)
    expect(ICONS[name][20].name).toBe(name)
  })

  it('uses the 16px glyph up to 16px and the 20px one above', () => {
    expect(glyphFor('user', 16).size).toBe(16)
    expect(glyphFor('user', 18).size).toBe(20)
    expect(glyphFor('user', 22).size).toBe(20)
  })

  it('draws at the requested size, in currentColor', () => {
    const { container } = render(<Icon name="login" size={18} />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '18')
    expect(svg).toHaveAttribute('fill', 'currentColor')
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(0)
  })

  it('is hidden from assistive technology unless labelled', () => {
    const { container, rerender } = render(<Icon name="user" />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    rerender(<Icon name="user" label="Account" />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'Account')
    expect(container.querySelector('svg')).toHaveAttribute('role', 'img')
  })

  it('refuses an icon outside the set', () => {
    expect(() => glyphFor('not-an-icon', 16)).toThrow(/Unknown icon/)
  })
})
