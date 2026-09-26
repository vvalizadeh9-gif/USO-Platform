import { LineChart, Scale, TrendingUp, Waypoints, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import { APPROVED, CRA, ICT, IDLE, PENDING, PLANNED, REJECTED, WASH } from './acceptanceTheme'
import ApprovalFlowSankey from './ApprovalFlowSankey'
import { mergeMonthlySeries } from './acceptancePlan'
import { AuthorityCompareBars, TrendLineChart, VelocityBars } from './acceptancePlanCharts'

const MONTHS = 9

/** A segmented Monthly/Cumulative toggle, the design system's own
 * `.seg`/`.seg-btn` pair — used here rather than the tab strip, since
 * picking a mode re-reads the same numbers, it does not switch to a
 * different question. */
function ModeToggle({ value, onChange, options }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`seg-btn ${value === o.value ? 'active' : ''}`}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function CardHead({ icon: Icon, title, sub, action }) {
  return (
    <div className="row wrap" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 4px', gap: 12 }}>
      <div>
        <h3 className="row" style={{ fontSize: 15, gap: 7 }}><Icon size={15} /> {title}</h3>
        {sub && <div className="dim" style={{ fontSize: 12.5, marginTop: 2 }}>{sub}</div>}
      </div>
      {action}
    </div>
  )
}

/**
 * Everything on the Overview tab that reads /acceptance/trends and
 * /drive-test/trend: the plan-vs-actual line chart, the approval-flow
 * Sankey, monthly velocity bars, the ICT/CRA comparison and the two mini
 * per-authority progress charts.
 *
 * A section of its own — not folded into the page component — because it
 * owns a second load (`/acceptance/trends`) and a third (`/drive-test/trend`)
 * that the page's single `/acceptance/overview` load has no reason to know
 * about. Both are programme-wide: the page carries no filters any more, so
 * neither call takes parameters beyond the month window.
 *
 * The dashed "Planned" line on the three progress charts is the acceptance
 * target a PM sets on the Monthly Plan page, as /acceptance/trends returns it
 * month by month — never a ramp drawn here. Where no month has a target, the
 * line and its legend entry are left out rather than drawn from a made-up
 * number.
 */
export default function AcceptancePlanSection({ total, analysis, kpis }) {
  const [trends, setTrends] = useState(null)
  const [trendsError, setTrendsError] = useState(false)
  const [dtTrend, setDtTrend] = useState(null)

  const [planMode, setPlanMode] = useState('cumulative')
  const [velocityMode, setVelocityMode] = useState('monthly')

  useEffect(() => {
    setTrendsError(false)
    api
      .get('/acceptance/trends', { params: { months: MONTHS } })
      .then((r) => setTrends(r.data))
      .catch(() => setTrendsError(true))
  }, [])

  useEffect(() => {
    api.get('/drive-test/trend', { params: { months: MONTHS } }).then((r) => setDtTrend(r.data)).catch(() => setDtTrend({ months: [] }))
  }, [])

  const months = useMemo(
    () => mergeMonthlySeries(trends?.months, dtTrend?.months),
    [trends, dtTrend]
  )

  // Whether any month in the window has a stored target. Without one there is
  // no plan to draw, and a legend entry for a line that is not there would be
  // a promise the chart cannot keep.
  const hasTarget = months.some((m) => m.target != null)
  const plannedSeries = (value) =>
    hasTarget ? [{ key: 'planned', label: 'Planned (target)', color: PLANNED, dashed: true, value }] : []

  const monthlyTarget = (m, i) => {
    if (m.target == null) return null
    const prev = months[i - 1]
    if (!prev || prev.target == null) return null
    return m.target - prev.target
  }

  const sankeyNodes = useMemo(() => {
    const fully = analysis.villages_both_approved ?? 0
    const ictOnly = analysis.villages_ict_not_cra ?? 0
    const craOnly = analysis.villages_cra_not_ict ?? 0
    const notStarted = Math.max(0, total - fully - ictOnly - craOnly)
    return [
      { key: 'fully', label: 'Fully accepted (ICT + CRA)', value: fully, color: APPROVED, wash: WASH[APPROVED] },
      { key: 'ict', label: 'ICT approved, CRA pending', value: ictOnly, color: ICT, wash: WASH[ICT] },
      { key: 'cra', label: 'CRA approved, ICT pending', value: craOnly, color: CRA, wash: WASH[CRA] },
      { key: 'none', label: 'Not started (no approval yet)', value: notStarted, color: IDLE, wash: WASH[IDLE] },
    ]
  }, [analysis, total])

  const compareRows = [
    {
      key: 'ict', name: 'ICT', color: ICT,
      parts: [
        { label: 'Approved', value: kpis.total_ict_approval ?? 0, color: ICT },
        { label: 'Pending', value: kpis.total_ict_pending ?? 0, color: PENDING },
        { label: 'Rejected', value: kpis.total_ict_rejected ?? 0, color: REJECTED },
      ],
    },
    {
      key: 'cra', name: 'CRA', color: CRA,
      parts: [
        { label: 'Approved', value: kpis.total_cra_approval ?? 0, color: CRA },
        { label: 'Pending', value: kpis.total_cra_pending ?? 0, color: PENDING },
        { label: 'Rejected', value: kpis.total_cra_rejected ?? 0, color: REJECTED },
      ],
    },
  ]

  const hasMonths = months.length > 0

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', alignItems: 'stretch', marginTop: 16 }}>
        <div className="card">
          <CardHead
            icon={LineChart}
            title="Plan vs actual progress"
            sub="Planned target, villages added and fully accepted, month by month"
            action={
              <ModeToggle
                value={planMode}
                onChange={setPlanMode}
                options={[{ value: 'monthly', label: 'Monthly' }, { value: 'cumulative', label: 'Cumulative' }]}
              />
            }
          />
          <div style={{ padding: '8px 20px 18px' }}>
            {trendsError ? (
              <div className="empty">Could not load the plan/actual trend.</div>
            ) : !hasMonths ? (
              <div className="empty">Loading trend…</div>
            ) : (
              <TrendLineChart
                ariaLabel="Plan versus actual progress, by Shamsi month"
                months={months}
                series={[
                  ...plannedSeries((m, i) => (planMode === 'cumulative' ? m.target : monthlyTarget(m, i))),
                  {
                    key: 'added', label: 'Added villages (actual)', color: ICT, area: true,
                    value: (m) => (planMode === 'cumulative' ? m.added_cumulative : m.added_new),
                  },
                  {
                    key: 'accepted', label: 'Fully accepted (ICT + CRA)', color: APPROVED, area: true,
                    value: (m) => (planMode === 'cumulative' ? m.fully_accepted_cumulative : m.fully_accepted_new),
                  },
                ]}
              />
            )}
            {hasMonths && (
              <div className="dim" style={{ fontSize: 12.5, marginTop: 10 }}>
                {hasTarget
                  ? 'The target line is the acceptance target set on the Monthly Plan page.'
                  : 'No acceptance target set yet. A PM sets it on the Monthly Plan page.'}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <CardHead icon={Waypoints} title="Approval flow & status distribution" sub={`Where all ${total} villages stand, ICT and CRA combined`} />
          <div style={{ padding: '8px 20px 18px' }}>
            <ApprovalFlowSankey total={total} nodes={sankeyNodes} />
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', alignItems: 'stretch', marginTop: 16 }}>
        <div className="card">
          <CardHead
            icon={Zap}
            title="Monthly approval velocity"
            sub="New approvals each month by ICT and CRA, and villages that became fully accepted"
            action={
              <ModeToggle
                value={velocityMode}
                onChange={setVelocityMode}
                options={[{ value: 'monthly', label: 'Monthly' }, { value: 'cumulative', label: 'Cumulative' }]}
              />
            }
          />
          <div style={{ padding: '8px 20px 18px' }}>
            {!hasMonths ? (
              <div className="empty">{trendsError ? 'Could not load the velocity trend.' : 'Loading trend…'}</div>
            ) : (
              <VelocityBars
                months={months}
                series={[
                  { key: 'ict', label: 'ICT approved', color: ICT, value: (m) => (velocityMode === 'cumulative' ? m.ict_cumulative : m.ict_new) },
                  { key: 'cra', label: 'CRA approved', color: CRA, value: (m) => (velocityMode === 'cumulative' ? m.cra_cumulative : m.cra_new) },
                  { key: 'full', label: 'Fully accepted', color: APPROVED, value: (m) => (velocityMode === 'cumulative' ? m.fully_accepted_cumulative : m.fully_accepted_new) },
                ]}
              />
            )}
          </div>
        </div>

        <div className="card">
          <CardHead
            icon={Scale}
            title="ICT vs CRA comparison"
            sub={`Each authority's villages by verdict, out of ${total}`}
          />
          <div style={{ padding: '14px 20px 20px' }}>
            <AuthorityCompareBars rows={compareRows} />
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', marginTop: 16 }}>
        <div className="card">
          <CardHead icon={TrendingUp} title="ICT approval progress" sub="Cumulative ICT approvals against the planned ramp" />
          <div style={{ padding: '8px 20px 18px' }}>
            {!hasMonths ? (
              <div className="empty">{trendsError ? 'Could not load the trend.' : 'Loading trend…'}</div>
            ) : (
              <TrendLineChart
                height={170}
                ariaLabel="ICT approval progress against the planned target"
                months={months}
                series={[
                  ...plannedSeries((m) => m.target),
                  { key: 'actual', label: 'Actual', color: ICT, area: true, value: (m) => m.ict_cumulative },
                ]}
              />
            )}
          </div>
        </div>
        <div className="card">
          <CardHead icon={TrendingUp} title="CRA approval progress" sub="Cumulative CRA approvals against the planned ramp" />
          <div style={{ padding: '8px 20px 18px' }}>
            {!hasMonths ? (
              <div className="empty">{trendsError ? 'Could not load the trend.' : 'Loading trend…'}</div>
            ) : (
              <TrendLineChart
                height={170}
                ariaLabel="CRA approval progress against the planned target"
                months={months}
                series={[
                  ...plannedSeries((m) => m.target),
                  { key: 'actual', label: 'Actual', color: CRA, area: true, value: (m) => m.cra_cumulative },
                ]}
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// "Not started" is grey, not red: red on this page means a refusal, and a
// village nobody has approved yet is an absence of activity, not a rejection.
