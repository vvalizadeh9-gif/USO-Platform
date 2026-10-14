import Icon from '../../components/Icon'
import { STEP_META } from './explorerModel'

const days = (n) => (n == null ? '—' : `${n} d`)
const stepName = (key) => STEP_META[key]?.phrase ?? key

/** The four compact tiles above the step path (UEP-11 §B5.1). Oldest
 * pending is left out when nothing is pending. Total aging runs from the
 * first dated step, which is on air when CPM carried its date. */
export default function AgingTiles({ aging, steps }) {
  const first = steps.find((s) => s.date)
  const currentStep = steps.find((s) => s.state === 'in_progress')?.key
  const longest = aging.longest_step
  const oldest = aging.oldest_pending
  const tiles = [
    { key: 'total', icon: 'time', label: 'Total aging', value: days(aging.total_days), context: first ? `since ${stepName(first.key)}` : null },
    {
      key: 'current', icon: 'hourglass', label: 'In current step', value: days(aging.current_step_days),
      context: currentStep ? `in ${stepName(currentStep)}` : 'all steps done',
    },
    {
      key: 'longest', icon: 'meter', label: 'Longest step', value: days(longest?.days),
      context: longest ? `${STEP_META[longest.from].label} to ${stepName(longest.to)}` : null,
    },
    oldest && {
      key: 'oldest', icon: 'pending', label: 'Oldest pending', value: days(oldest.days), tone: 'pending',
      context: `${oldest.authority}, ${oldest.villages} ${oldest.villages === 1 ? 'village' : 'villages'}`,
    },
  ].filter(Boolean)

  return (
    <ul className="ex-aging" aria-label="Aging">
      {tiles.map((t) => (
        <li key={t.key} className={`ex-aging-tile ${t.tone ? `is-${t.tone}` : ''}`.trim()} data-tile={t.key}>
          <span className="ex-aging-icon" aria-hidden="true"><Icon name={t.icon} size={16} /></span>
          <span className="ex-aging-text">
            <span className="ex-aging-label">{t.label}</span>
            <span className="ex-aging-line">
              <b className="ex-aging-value">{t.value}</b>
              {t.context && <span className="ex-aging-context">{t.context}</span>}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}
