// "Too many attempts" with a ring that empties as the lockout runs out
// (UEP-26). Neutral grey, not red: nothing is broken, it is a pause.
import Icon from '../../components/Icon'
import { formatCountdown } from '../../lib/signInErrors'

const RADIUS = 13
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** @param {{ remaining: number, total: number }} props */
export default function LockoutBox({ remaining, total }) {
  const left = total > 0 ? Math.min(1, remaining / total) : 0
  return (
    <div className="uep-signin-lock" role="status">
      <span className="uep-signin-ring">
        <svg viewBox="0 0 30 30" aria-hidden="true" focusable="false">
          <circle className="uep-signin-ring-track" cx="15" cy="15" r={RADIUS} />
          <circle
            className="uep-signin-ring-fill"
            cx="15"
            cy="15"
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE.toFixed(2)}
            strokeDashoffset={(CIRCUMFERENCE * (1 - left)).toFixed(2)}
          />
        </svg>
        <Icon name="locked" size={16} className="uep-signin-ring-icon" />
      </span>
      <span>
        <b>Too many attempts</b>
        <span className="uep-signin-lock-text">
          Try again in <span className="uep-signin-tabular">{formatCountdown(remaining)}</span>
        </span>
      </span>
    </div>
  )
}
