import { SegmentedControl } from '../../../components/ui'
import { CUMULATIVE, LAST_12 } from './flowView'

/**
 * Which months "Where this is going" shows, as one segmented control in the
 * card's title row: Last 12 months (the default), Cumulative (every month
 * since Farvardin 1404), then one option per Shamsi year the payload covers,
 * oldest first. The years come from the data, so a new year appears on its
 * own.
 *
 * Every view draws the same running totals; a window is a window onto them,
 * not a count restarted at zero (see `flowView`).
 */
export default function FlowViewControl({ years, scope, onScope }) {
  const fixed = [LAST_12, CUMULATIVE]
  const current = fixed.includes(scope) || years.includes(scope) ? scope : LAST_12
  const options = [
    { key: LAST_12, label: 'Last 12 months' },
    { key: CUMULATIVE, label: 'Cumulative' },
    ...years.map((y) => ({ key: y, label: String(y) })),
  ]
  return <SegmentedControl label="Chart period" options={options} value={current} onChange={onScope} />
}
