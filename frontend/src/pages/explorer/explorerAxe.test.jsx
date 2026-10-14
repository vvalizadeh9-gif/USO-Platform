// axe over Explorer's record page in jsdom (UEP-11 §B9): roles, names, the
// filter's tab pattern, the focusable scrolling table. Contrast needs a real
// browser and is checked by the Playwright spec (e2e/explorer.spec.js). The
// list page is covered with the other work pages (workPagesAxe.test.jsx).
import { act, render } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { manyVillages, record } from './fixtures'

const body = vi.hoisted(() => ({ current: null }))
vi.mock('../../api/client', () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: body.current })), post: vi.fn() },
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role: { name: 'PM' } } }) }))

const SiteRecord = (await import('./SiteRecord')).default
const { ToastProvider } = await import('../../context/ToastContext')

const CASES = [
  ['three villages', record()],
  ['ten villages (table)', record({ villages: manyVillages(10) })],
  ['acceptance not started', record({ acceptance_started: false })],
  ['a site awaiting assignment', record({ workflow: { current_stage: 'Ready for Assignment', active_drive_test_id: null, dt_submission_date: null } })],
]

describe('the site record page has no axe violations', () => {
  it.each(CASES)('%s', async (_name, data) => {
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
    const result = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    })
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0].html.slice(0, 160)}`)).toEqual([])
  }, 20000)
})
