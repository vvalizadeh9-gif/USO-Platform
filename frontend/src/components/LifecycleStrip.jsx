import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { NAV_BY_PATH, navItemVisible } from '../lib/nav'

/**
 * Where the page you are on sits in the project, and what comes before and
 * after it.
 *
 * Health Check and Drive Test are now two screens rather than one row of
 * tabs. That is the right split, but it costs the thing the single row gave
 * for free: you could see that one followed the other. This says it in three
 * steps instead, on both pages.
 *
 * A step is a link only if the person can open it, and the sidebar's own rule
 * decides that from the sidebar's own lists — see lib/nav — so the strip can
 * never offer a screen the sidebar does not. A step they cannot open stays
 * visible as plain text: the process has three parts whoever is reading it,
 * and dropping one would make the strip say different things to different
 * people about what the work is.
 *
 * Two variants, not one strip reused with different labels: a contractor's
 * three steps are three different screens (My Health Check, My Drive Tests),
 * not the staff ones with a contractor-friendly hint, so the ``to`` targets
 * differ and not just the wording.
 */
const STAFF_STEPS = [
  { key: 'plan', label: 'Monthly Plan', hint: 'Target for the month', to: '/monthly-plan' },
  { key: 'hc', label: 'Health Check', hint: 'Check · confirm · route fixes', to: '/health-check' },
  { key: 'dt', label: 'Drive Test', hint: 'Assign · progress · review', to: '/drive-test' },
]

const CONTRACTOR_STEPS = [
  { key: 'plan', label: 'Monthly Plan', hint: 'Your count for the month', to: '/monthly-plan' },
  { key: 'hc', label: 'My Health Check', hint: 'Sites to check', to: '/my-health-check' },
  { key: 'dt', label: 'My Drive Tests', hint: 'Sites to drive-test', to: '/my-drive-tests' },
]

export default function LifecycleStrip({ current, variant = 'staff' }) {
  const { user } = useAuth()
  const roleName = user?.role?.name
  const STEPS = variant === 'contractor' ? CONTRACTOR_STEPS : STAFF_STEPS

  return (
    <nav className="lifecycle" aria-label="Where this page sits in the project">
      {STEPS.map((step, i) => {
        const isCurrent = step.key === current
        const reachable = navItemVisible(NAV_BY_PATH[step.to], roleName)

        const body = (
          <>
            <span className="lifecycle-label">{step.label}</span>
            <span className="lifecycle-hint">{step.hint}</span>
          </>
        )

        // The chevron travels with the step that follows it, so a wrap puts
        // the separator on the new line rather than leaving it dangling at
        // the end of the old one.
        return (
          <div className="lifecycle-cell" key={step.key}>
            {i > 0 && <ChevronRight size={15} className="lifecycle-sep" aria-hidden="true" />}
            {isCurrent ? (
              <span className="lifecycle-step is-current" aria-current="page">
                {body}
              </span>
            ) : reachable ? (
              <Link className="lifecycle-step" to={step.to}>
                {body}
              </Link>
            ) : (
              <span className="lifecycle-step is-muted">{body}</span>
            )}
          </div>
        )
      })}
    </nav>
  )
}
