import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import Select from './Select'

function Harness({ count = 3 }) {
  const [value, setValue] = useState('b')
  const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda']
  return (
    <Select aria-label="Letter" value={value} onChange={(e) => setValue(e.target.value)}>
      {names.slice(0, count).map((n, i) => (
        <option key={n} value={'abcdefghijk'[i]}>{n}</option>
      ))}
    </Select>
  )
}

const combo = () => screen.getByRole('combobox', { name: 'Letter' })

describe('Select', () => {
  it('is a combobox showing the chosen option', () => {
    render(<Harness />)
    expect(combo()).toHaveTextContent('Beta')
    expect(combo()).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens on Enter, moves with the arrows, selects with Enter and gives focus back', () => {
    render(<Harness />)
    combo().focus()
    fireEvent.keyDown(combo(), { key: 'Enter' })
    expect(combo()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(combo(), { key: 'ArrowDown' })
    fireEvent.keyDown(combo(), { key: 'Enter' })
    expect(combo()).toHaveTextContent('Gamma')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(combo())
  })

  it('closes on Esc without changing the value', () => {
    render(<Harness />)
    fireEvent.keyDown(combo(), { key: ' ' })
    fireEvent.keyDown(combo(), { key: 'ArrowDown' })
    fireEvent.keyDown(combo(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(combo()).toHaveTextContent('Beta')
  })

  it('jumps by typing while closed', () => {
    render(<Harness />)
    fireEvent.keyDown(combo(), { key: 'g' })
    expect(combo()).toHaveTextContent('Gamma')
  })

  it('adds a search box above ten options', () => {
    render(<Harness count={11} />)
    fireEvent.click(combo())
    const search = screen.getByRole('searchbox', { name: 'Search options' })
    fireEvent.change(search, { target: { value: 'lam' } })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Lambda'])
  })
})
