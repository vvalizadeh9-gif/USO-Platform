// axe over Explorer's record page in jsdom (UEP-11 §B9, UEP-28 §E): roles,
// names, the filter's tab pattern, the focusable scrolling table, and the
// open village history panel. Contrast needs a real
// browser and is checked by the Playwright spec (e2e/explorer.spec.js). The
// list page is covered with the other work pages (workPagesAxe.test.jsx).
import { act, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { manyVillages, record } from './fixtures'

const body = vi.hoisted(() => ({ current: null }))
vi.mock('../../api/client', () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: body.current })), post: vi.fn() },
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => globalThis.withSeededAccess({ user: { role: { name: 'PM' } } }) }))

const SiteRecord = (await import('./SiteRecord')).default
const { ToastProvider } = await import('../../context/ToastContext')

const CASES = [
  ['one village', record({ villages: manyVillages(1) })],
  ['three villages', record()],
  ['five villages', record({ villages: manyVillages(5) })],
  ['the village history panel open', record(), true],
  ['fifteen villages', record({ villages: manyVillages(15) })],
  ['ten villages (table)', record({ villages: manyVillages(10) })],
  ['a missing contractor', { ...record(), general: { ...record().general, dt_contractor: null } }],
  ['acceptance not started', record({ acceptance_started: false })],
  ['a site awaiting assignment', record({ workflow: { current_stage: 'Ready for Assignment', active_drive_test_id: null, dt_submission_date: null } })],
]

describe('the site record page has no axe violations', () => {
  it.each(CASES)('%s', async (_name, data, openHistory) => {
    body.current = data
    const { container } = render(
      <MemoryRouter initialEntries={['/explorer/sites/7?village=V10002']}>
        <ToastProvider>
          <Routes>
            <Route path="/explorer/sites/:workItemId" element={<SiteRecord />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    )
    await act(async () => {})
    if (openHistory) fireEvent.click(screen.getByRole('button', { name: /History/ }))
    const result = await axe.run(openHistory ? document.body : container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    })
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0].html.slice(0, 160)}`)).toEqual([])
  }, 20000)
})
