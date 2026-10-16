import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import PageHeader, { HeaderCount } from './PageHeader'

const css = readFileSync(resolve(process.cwd(), 'src/styles/shell.css'), 'utf-8')
const rule = (selector) => css.match(new RegExp(`${selector.replace(/[.]/g, '[.]')} [{]([^}]*)[}]`))?.[1] ?? ''

describe('PageHeader', () => {
  it('is 64px high without tabs and 104px with them, whatever it holds', () => {
    expect(rule('.uep-page-header')).toMatch(/height: 64px;/)
    expect(rule('.uep-page-header.has-tabs')).toMatch(/height: 104px;/)
    expect(rule('.uep-page-header-tabs')).toMatch(/height: 40px;/)
  })

  it('marks the tab row so the taller height applies', () => {
    const { container, rerender } = render(<PageHeader title="Roles performance" />)
    expect(container.firstChild).not.toHaveClass('has-tabs')
    rerender(<PageHeader title="Roles performance" tabs={<div role="tablist" />} />)
    expect(container.firstChild).toHaveClass('has-tabs')
  })

  it('leads with "224 waiting · 26 late", late only above zero', () => {
    const { container, rerender } = render(<PageHeader title="Filing" count={<HeaderCount waiting={224} late={26} />} />)
    expect(container.querySelector('.uep-page-header-count')).toHaveTextContent('224 waiting · 26 late')
    expect(screen.getByText('26 late')).toHaveClass('uep-page-header-late')
    rerender(<PageHeader title="Filing" count={<HeaderCount waiting={5} late={0} />} />)
    expect(container.querySelector('.uep-page-header-count')).toHaveTextContent(/^5 waiting$/)
  })
})
