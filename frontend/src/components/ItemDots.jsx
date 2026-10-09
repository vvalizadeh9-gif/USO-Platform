/**
 * The dot rule, in one place: up to DOTS_MAX items get one dot each (grey on
 * time, amber due soon, red late); more than that get one proportional bar of
 * the same height, because a hundred dots is a texture, not a count.
 *
 * Decorative: `aria-hidden`, and the row that holds it carries the same
 * figures in words (`dotsLabel` in lib/itemDots.js).
 */
import { DOTS_MAX } from '../lib/itemDots'

export default function ItemDots({ onTime = 0, dueSoon = 0, late = 0 }) {
  const total = onTime + dueSoon + late
  if (total === 0) return null
  if (total > DOTS_MAX) {
    return (
      <span className="item-bar" aria-hidden="true" data-testid="item-bar">
        {onTime > 0 && <i className="on-time" style={{ flexGrow: onTime }} />}
        {dueSoon > 0 && <i className="due-soon" style={{ flexGrow: dueSoon }} />}
        {late > 0 && <i className="late" style={{ flexGrow: late }} />}
      </span>
    )
  }
  const dots = [
    ...Array(onTime).fill('on-time'),
    ...Array(dueSoon).fill('due-soon'),
    ...Array(late).fill('late'),
  ]
  return (
    <span className="item-dots" aria-hidden="true" data-testid="item-dots">
      {dots.map((kind, i) => (
        <i key={i} className={kind} />
      ))}
    </span>
  )
}
