// UEP-31 §1.2: the four pipeline steps show no rail count (the strip shows it);
// Remediation and Submissions keep theirs, and Home's counts are unchanged.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import AppRail from './AppRail'
import { appCount, appsFor } from './appRegistry'
import { userWithAccess } from '../test/seededAccess'

const COUNTS = { hc_assign: 48, hc_review: 12, dt_assign: 38, dt_review: 7, hc_reroutes: 3, submit_to_ict: 9 }

describe('the Drive test rail', () => {
  it('hides the counts the flow strip already shows', () => {
    const app = appsFor(userWithAccess({ role: { name: 'PM' } })).find((a) => a.id === 'drive-test')
    render(<MemoryRouter><AppRail app={app} activePage={app.pages[1]} counts={COUNTS} /></MemoryRouter>)
    for (const n of ['48', '12', '38', '7']) expect(screen.queryByText(n)).toBeNull()
    expect(screen.getByRole('link', { name: /Remediation/ })).toHaveTextContent('3')
    expect(screen.getByRole('link', { name: /Submissions/ })).toHaveTextContent('9')
    // Home still adds every queue up.
    expect(appCount(app, COUNTS)).toBe(48 + 12 + 38 + 7 + 3 + 9)
  })
})
