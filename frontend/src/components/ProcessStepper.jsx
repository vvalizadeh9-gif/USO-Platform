import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { STAFF_STEPS } from '../lib/lifecycle'
import { NAV_BY_PATH, navItemVisible } from '../lib/nav'

/**
 * The drive test process as three numbered steps -- Monthly Plan › Health
 * Check › Drive Test -- in the PageBar's context slot.
 *
 * The compact form of LifecycleStrip, with the same steps and the same rule
 * for links: a step is a link only if the sidebar would offer this person
 * that screen (lib/nav), and a step they cannot open stays as plain text, so
 * the process reads the same to everyone. The current step is marked in the
 * accent wash with a filled number, and `aria-current="step"`. On a
 * narrower header the other steps collapse to their numbers (CSS); each
 * keeps its name as its accessible label and tooltip.
 */
export default function ProcessStepper({ current }) {
  const { user } = useAuth()
  const roleName = user?.role?.name

  return (
    <nav className="stepper" aria-label="Drive test process">
      <ol>
        {STAFF_STEPS.map((step, i) => {
          const isCurrent = step.key === current
          const reachable = navItemVisible(NAV_BY_PATH[step.to], roleName)
          const body = (
            <>
              <span className="stepper-num" aria-hidden="true">{i + 1}</span>
              <span className="stepper-label">{step.label}</span>
            </>
          )
          return (
            <li key={step.key}>
              {i > 0 && <ChevronRight size={14} className="stepper-sep" aria-hidden="true" />}
              {isCurrent ? (
                <span className="stepper-step is-current" aria-current="step">{body}</span>
              ) : reachable ? (
                <Link className="stepper-step" to={step.to} title={`${step.label} · ${step.hint}`} aria-label={step.label}>
                  {body}
                </Link>
              ) : (
                <span className="stepper-step is-muted" title={step.label}>{body}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
