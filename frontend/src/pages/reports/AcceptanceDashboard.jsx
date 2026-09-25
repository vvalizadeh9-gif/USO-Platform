import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  Clock,
  FileQuestion,
  Hourglass,
  Target,
  XCircle,
} from 'lucide-react'
import api from '../../api/client'
import { Loading, PageHead } from '../../components/ui'
import AcceptancePlanSection from './AcceptancePlanSection'
import { APPROVED, IDLE, PENDING, REJECTED, WASH } from './acceptanceTheme'
import { fmtCount } from './kpiTheme'
import PlanTargetCard from './PlanTargetCard'

// Where a number goes when it is clicked: My Work, filtered to exactly the
// villages it counted. The Action Center's counters already open that screen
// this way, so a figure behaves the same wherever it is met.
const workLink = (params) =>
  `/my-work?${new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  )}`

/**
 * Reports → Acceptance Dashboard: where ICT/CRA status is *read*.
 *
 * This is the reporting half of what used to be one Acceptance page with tabs.
 * The other half — actually filing and validating letters — is My Work. They
 * were split because they are different jobs done by different people at
 * different times, and a screen that tried to be both made the reader wade
 * through a work queue and the worker wade through KPIs.
 *
 * What is left after the simplification pass is one column of it: the KPI
 * band, the three figures that make up what is outstanding, and the six
 * plan-and-trend widgets. No filter bar, no second tab, no province table —
 * the per-province and per-authority detail all lives in My Work, which every
 * figure here opens.
 *
 * Two rules still hold everywhere on this page:
 *
 * Every number opens the list it counted. A figure that cannot be examined is
 * a figure that gets argued with.
 *
 * Counts are of every (site, village) row in the DT-Done هدف universe,
 * duplicates kept — see acceptance_analytics.py. Nothing here writes, apart
 * from the PM-only monthly target on `PlanTargetCard`.
 */
export default function AcceptanceDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setError(false)
    api
      .get('/acceptance/overview')
      .then((r) => setData(r.data))
      .catch(() => setError(true))
  }, [])

  if (error) return <div className="card"><div className="empty">Could not load acceptance data.</div></div>
  if (!data) return <Loading label="Loading acceptance data" />

  return (
    <>
      <PageHead
        eyebrow="Reports"
        title="Acceptance Dashboard"
        subtitle="ICT and CRA approval across your provinces, village by village."
      />
      <Overview data={data} />
    </>
  )
}

/* ---------------------------------------------------------------- Overview */

/**
 * The whole page below the head: four KPI cards, the three outstanding
 * figures under them, and the plan-and-trend widgets.
 *
 * The KPI band borrows the Drive Test dashboard's card system wholesale
 * (`drivetest/KpiBand.jsx`, `.dt-kpi-*` in app.css) rather than keeping a
 * second, nearly-identical set of KPI cards alive: same 4-column grid, same
 * compact padding, same 3px accent edge and inline icon chip. Only the
 * accent hues differ, and those come from this page's own palette — see the
 * `data-kpi="acc-*"` blocks beside the drive test ones.
 */
function Overview({ data }) {
  const navigate = useNavigate()
  const { kpis, analysis } = data
  const total = kpis.total_dt_done_villages
  const accepted = analysis.villages_accepted ?? analysis.villages_both_approved ?? 0
  const remaining = total - accepted
  const acceptedPct = total ? Math.round((accepted / total) * 100) : 0
  const remainingPct = total ? Math.round((remaining / total) * 100) : 0

  // The plan is programme-wide, so it is loaded once here rather than folded
  // into the overview payload.
  const [plan, setPlan] = useState(null)
  const loadPlan = useCallback(() => {
    api.get('/acceptance/plan').then((r) => setPlan(r.data)).catch(() => setPlan(null))
  }, [])
  useEffect(loadPlan, [loadPlan])

  // The three ways a village can still be outstanding. They used to be
  // crammed three-across inside the Remaining card, where at four cards wide
  // every label wrapped onto three lines; given the page's full width they
  // read in one. Each keeps the drill-through it had.
  const outstanding = [
    {
      key: 'needs_attention',
      icon: XCircle,
      label: 'Needs an answer',
      color: REJECTED,
      value: analysis.villages_needs_attention ?? 0,
      to: workLink({ bucket: 'needs_attention' }),
    },
    {
      key: 'awaiting_review',
      icon: Hourglass,
      label: 'With an authority',
      color: PENDING,
      value: analysis.villages_in_review ?? 0,
      to: workLink({ bucket: 'awaiting_review' }),
    },
    {
      key: 'ready',
      icon: FileQuestion,
      label: 'Never filed',
      color: IDLE,
      value: analysis.villages_not_filed ?? 0,
      to: workLink({ bucket: 'ready' }),
    },
  ]

  return (
    <>
      <section className="dt-kpi-band" aria-label="Acceptance totals">
        <div className="dt-kpi-card" data-kpi="acc-total">
          <div className="dt-kpi-hd">
            <span className="dt-kpi-ic" aria-hidden="true">
              <Target size={13} strokeWidth={2.2} />
            </span>
            <span className="dt-kpi-title">Total villages</span>
          </div>
          <div className="dt-kpi-v">
            <span className="dt-kpi-figure tnum">{fmtCount(total)}</span>
          </div>
          <div className="dt-kpi-sub">Drive-test done</div>
        </div>

        <PlanTargetCard plan={plan} onSaved={loadPlan} />

        <div className="dt-kpi-card" data-kpi="acc-approved">
          <div className="dt-kpi-hd">
            <span className="dt-kpi-ic" aria-hidden="true">
              <CheckCircle2 size={13} strokeWidth={2.2} />
            </span>
            <span className="dt-kpi-title">Fully approved</span>
          </div>
          <div className="dt-kpi-v">
            <button
              className="drill dt-kpi-figure tnum"
              onClick={() => navigate(workLink({ bucket: 'closed' }))}
              aria-label={`Fully approved: ${accepted} villages — open the list`}
            >
              {fmtCount(accepted)}
            </button>
          </div>
          <div className="dt-kpi-sub">{acceptedPct}% of {fmtCount(total)}</div>
          <ShareBar pct={acceptedPct} color={APPROVED} />
        </div>

        <div className="dt-kpi-card" data-kpi="acc-remaining">
          <div className="dt-kpi-hd">
            <span className="dt-kpi-ic" aria-hidden="true">
              <Clock size={13} strokeWidth={2.2} />
            </span>
            <span className="dt-kpi-title">Remaining</span>
          </div>
          <div className="dt-kpi-v">
            <span className="dt-kpi-figure tnum">{fmtCount(remaining)}</span>
          </div>
          <div className="dt-kpi-sub">{remainingPct}% of {fmtCount(total)}</div>
          <ShareBar pct={remainingPct} color={REJECTED} />
        </div>
      </section>

      <div className="acc-remaining-strip">
        {outstanding.map((o) => (
          <button
            key={o.key}
            type="button"
            className="drill acc-remaining-tile"
            onClick={() => navigate(o.to)}
            aria-label={`${o.label}: ${o.value} villages — open the list`}
          >
            <span
              className="acc-tile-ic"
              aria-hidden="true"
              style={{ background: WASH[o.color] || 'var(--surface-3)', color: o.color }}
            >
              <o.icon size={13} strokeWidth={2.2} />
            </span>
            <span className="acc-tile-label">{o.label}</span>
            <span className="acc-tile-num tnum">{o.value}</span>
          </button>
        ))}
      </div>

      <AcceptancePlanSection total={total} analysis={analysis} kpis={kpis} />
    </>
  )
}

/** A KPI card's share track: `pct` in the card's own colour, the rest the
 * band's neutral. Decorative — the line above it says the same in words. */
function ShareBar({ pct, color }) {
  return (
    <div className="dt-kpi-split" role="presentation" aria-hidden="true">
      <i style={{ width: `${Math.max(pct, 0.5)}%`, background: color }} />
    </div>
  )
}
