import { LineChart, Scale, TrendingUp, Waypoints, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import { APPROVED, CRA, ICT, IDLE, PENDING, PLANNED, REJECTED, WASH } from './acceptanceTheme'
import ApprovalFlowSankey from './ApprovalFlowSankey'
import PlanTargetCard from './PlanTargetCard'
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
 * /drivetest/trend: the plan-vs-actual line chart, the approval-flow
 * Sankey, monthly velocity bars, the ICT/CRA comparison and the two mini
 * per-authority progress charts.
 *
 * A section of its own — not folded into the page component — because it
 * owns a second load (`/acceptance/trends`) and a third (`/drivetest/trend`)
 * that the page's single `/acceptance/overview` load has no reason to know
 * about. Both are programme-wide: the page carries no filters any more, so
 * neither call takes parameters beyond the month window.
 *
 * The monthly plan target lives here too, and loads with them. It used to be
 * the second card in the KPI band, in the middle of a funnel it is not a step
 * of: that band counts what has happened, and a target is what was promised.
 * Beside the plan-vs-actual chart it is read against the line it sets.
 */
export default function AcceptancePlanSection({ total, analysis, kpis }) {
  const [trends, setTrends] = useState(null)
  const [trendsError, setTrendsError] = useState(false)
  const [dtTrend, setDtTrend] = useState(null)
  const [plan, setPlan] = useState(null)

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
    api.get('/drivetest/trend', { params: { months: MONTHS } }).then((r) => setDtTrend(r.data)).catch(() => setDtTrend({ months: [] }))
  }, [])

  // The plan is programme-wide, so it is loaded once here rather than folded
  // into the overview payload. Re-read after a PM saves, so the card and the
  // chart's target line move together.
  const loadPlan = useCallback(() => {
    api.get('/acceptance/plan').then((r) => setPlan(r.data)).catch(() => setPlan(null))
  }, [])
  useEffect(loadPlan, [loadPlan])

  const months = useMemo(
    () => mergeMonthlySeries(trends?.months, dtTrend?.months),
    [trends, dtTrend]
  )

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
      {/* The target, at the head of the section it governs. Narrow on
          purpose: it is one figure and a PM-only control, and a card stretched
          across the page would read as a fifth KPI — which is exactly the
          confusion that moving it out of the band was meant to end. */}
      <section className="acc-plan-row" aria-label="Acceptance plan target">
        <PlanTargetCard plan={plan} onSaved={loadPlan} />
      </section>

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
                  {
                    key: 'planned', label: 'Planned (target)', color: PLANNED, dashed: true,
                    value: (m, i) => (planMode === 'cumulative' ? m.target : monthlyTarget(m, i)),
                  },
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
                  { key: 'planned', label: 'Planned (target)', color: PLANNED, dashed: true, value: (m) => m.target },
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
                  { key: 'planned', label: 'Planned (target)', color: PLANNED, dashed: true, value: (m) => m.target },
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
