import { BEHIND_PERCENT, signedNumber } from './history'
import { PAD } from './chartLayout'

/**
 * Under the chart: the Gap (actual less PIP) and the share of PIP delivered,
 * one cell per month in the chart's own columns. Completed months only; the
 * running month and the months ahead are blank.
 */
export default function StripRows({ rows }) {
  const style = { paddingInlineStart: PAD.left, paddingInlineEnd: PAD.right }
  return (
    <div className="mp2-strips">
      <div className="mp2-strip" style={style}>
        <span className="mp2-strip-label">Gap</span>
        {rows.map((r) => (
          <span
            key={r.month}
            className="mp2-strip-cell tnum"
            data-tone={r.gap == null ? undefined : r.gap < 0 ? 'danger' : r.gap > 0 ? 'accent' : 'muted'}
          >
            {r.gap == null ? '' : signedNumber(r.gap)}
          </span>
        ))}
      </div>
      <div className="mp2-strip" style={style}>
        <span className="mp2-strip-label">%</span>
        {rows.map((r) => (
          <span key={r.month} className="mp2-strip-cell tnum" data-tone={r.pct != null && r.pct < BEHIND_PERCENT ? 'danger' : undefined}>
            {r.pct == null ? '' : `${r.pct}%`}
          </span>
        ))}
      </div>
    </div>
  )
}
