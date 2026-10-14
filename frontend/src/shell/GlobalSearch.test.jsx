import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }))

const api = (await import('../api/client')).default
const { default: GlobalSearch, SEARCH_DELAY_MS } = await import('./GlobalSearch')
const { appsFor } = await import('./appRegistry')

const SITES = {
  key: 'sites',
  label: 'Sites',
  total: 212,
  items: [
    { id: 7, title: 'KRM-0007', subtitle: 'New · Kerman', route: '/work-items/7' },
    { id: 8, title: 'KRM-0008', subtitle: 'New · Kerman', route: '/work-items/8' },
  ],
}

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.pathname + loc.search}</output>
}

function draw(role = 'PM') {
  render(
    <MemoryRouter>
      <GlobalSearch apps={appsFor(role)} />
      <Where />
    </MemoryRouter>,
  )
  return screen.getByRole('combobox')
}

/** Type, then let the debounce and the answer through. */
async function type(box, text) {
  await userEvent.type(box, text)
  await act(async () => {
    await new Promise((r) => setTimeout(r, SEARCH_DELAY_MS + 30))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ data: { query: 'krm', groups: [SITES] } })
})

describe('GlobalSearch', () => {
  it('is a combobox that says what it searches', () => {
    const box = draw()
    expect(box).toHaveAccessibleName(/sites, villages, contractors, people and pages/i)
    expect(box).toHaveAttribute('aria-expanded', 'false')
  })

  it('asks the server nothing for one character', async () => {
    const box = draw()
    await type(box, 'k')
    expect(api.get).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('asks once typing pauses, not on every key', async () => {
    const box = draw()
    await type(box, 'krm')
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(api.get.mock.calls[0][0]).toBe('/search')
    expect(api.get.mock.calls[0][1].params).toEqual({ q: 'krm' })
  })

  it('lists what the server found, with the true total and a way to see all', async () => {
    const box = draw()
    await type(box, 'krm')
    expect(await screen.findByRole('option', { name: /KRM-0007/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /KRM-0008/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'See all 212 sites' })).toBeInTheDocument()
  })

  it('lists matching pages at once, from the role\'s own apps', async () => {
    const box = draw('PM')
    await userEvent.type(box, 'lifecycle')
    expect(screen.getByRole('option', { name: /Lifecycle gaps/ })).toBeInTheDocument()
  })

  it('offers a contractor no page they cannot open', async () => {
    const box = draw('Contractor')
    await userEvent.type(box, 'audit')
    expect(screen.queryByRole('option', { name: /Audit log/ })).not.toBeInTheDocument()
  })

  it('opens a result on click and clears the box', async () => {
    const box = draw()
    await type(box, 'krm')
    await userEvent.click(await screen.findByRole('option', { name: /KRM-0008/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/work-items/8')
    expect(box).toHaveValue('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('walks the list with the arrow keys and opens the highlighted row on Enter', async () => {
    const box = draw()
    await type(box, 'krm')
    await screen.findByRole('option', { name: /KRM-0007/ })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /KRM-0008/ })).toHaveAttribute('aria-selected', 'true')
    expect(box).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /KRM-0008/ }).id)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByTestId('where')).toHaveTextContent('/work-items/8')
  })

  it('opens the first result on Enter with nothing highlighted', async () => {
    const box = draw()
    await type(box, 'krm')
    await screen.findByRole('option', { name: /KRM-0007/ })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByTestId('where')).toHaveTextContent('/work-items/7')
  })

  it('searches all sites on Enter when nothing matched', async () => {
    api.get.mockResolvedValue({ data: { query: 'zzzz', groups: [] } })
    const box = draw()
    await type(box, 'zzzz')
    expect(await screen.findByText(/No results for/)).toBeInTheDocument()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByTestId('where')).toHaveTextContent('/work-items?q=zzzz')
  })

  it('closes and clears on Escape', async () => {
    const box = draw()
    await type(box, 'krm')
    await screen.findByRole('listbox')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(box).toHaveValue('')
  })

  it('says so when the server is unreachable, and keeps the pages', async () => {
    api.get.mockRejectedValue(new Error('network'))
    const box = draw('PM')
    await type(box, 'lifecycle')
    expect(await screen.findByRole('alert')).toHaveTextContent(/Search is unavailable/)
    expect(screen.getByRole('option', { name: /Lifecycle gaps/ })).toBeInTheDocument()
  })

  it('never shows a slow answer to an earlier word against a later one', async () => {
    let release
    api.get.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    api.get.mockResolvedValueOnce({ data: { query: 'krmx', groups: [] } })
    const box = draw()
    await userEvent.type(box, 'krm')
    await act(async () => {
      await new Promise((r) => setTimeout(r, SEARCH_DELAY_MS + 30))
    })
    await type(box, 'x')
    // The first request was cancelled when the text changed; even if it
    // answers now, its sites are not listed against "krmx".
    await act(async () => release({ data: { query: 'krm', groups: [SITES] } }))
    await waitFor(() => expect(screen.queryByRole('option', { name: /KRM-0007/ })).not.toBeInTheDocument())
  })

  it('focuses on Ctrl+K', () => {
    const box = draw()
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(box).toHaveFocus()
  })
})
