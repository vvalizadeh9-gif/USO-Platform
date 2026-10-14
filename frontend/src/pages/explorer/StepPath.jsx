import Icon from '../../components/Icon'
import { STEP_META, pillText, stepAccessibleName, stepDateText } from './explorerModel'

/**
 * The site's five steps on one line (UEP-11 §B5.2), in the process's order.
 * An ordered list: each step's accessible name carries its name, state and
 * date, and the aging pill before it. The pills sit on the line between two
 * steps; the first step has none.
 */
export default function StepPath({ steps }) {
  return (
    <ol className="ex-steps" aria-label="Journey">
      {steps.map((step, i) => {
        const meta = STEP_META[step.key]
        return (
          <li key={step.key} className={`ex-step is-${step.state}`} aria-label={stepAccessibleName(step)}>
            {i > 0 && (
              <span
                className={`ex-step-pill ${step.state === 'in_progress' ? 'is-open' : ''}`.trim()}
                aria-hidden="true"
              >
                {pillText(step)}
              </span>
            )}
            <span className="ex-step-circle" aria-hidden="true">
              <Icon name={meta.icon} size={20} />
              {meta.badge && (
                <span className="ex-step-badge">
                  <Icon name="checkmark" size={16} />
                </span>
              )}
            </span>
            <span className="ex-step-name" aria-hidden="true">{meta.label}</span>
            <span className={`ex-step-date ${step.state === 'done' && !step.date ? 'is-muted' : ''}`.trim()} aria-hidden="true">
              {stepDateText(step)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
