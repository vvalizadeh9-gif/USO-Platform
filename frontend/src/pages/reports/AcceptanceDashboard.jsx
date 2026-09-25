import { useEffect, useState } from 'react'
import { CheckCircle2, Clock, RadioTower, Target } from 'lucide-react'
import api from '../../api/client'
import { Loading, PageHead } from '../../components/ui'
import AcceptancePlanSection from './AcceptancePlanSection'
import { AcceptanceDrillProvider, DrillFigure } from './AcceptanceDrillPanel'
import { APPROVED, ICT, PENDING, REJECTED } from './acceptanceTheme'
import { fmtCount } from './kpiTheme'

/**
 * Reports → Acceptance Dashboard: where ICT/CRA status is *read*.
 *
 * This is the reporting half of what used to be one Acceptance page with tabs.
 * The other half — actually filing and validating letters — is My Work. They
 * were split because they are different jobs done by different people at
 * different times, and a screen that tried to be both made the reader wade
 * through a work queue and the worker wade through KPIs.
 *
 * What is left is one column of it: the KPI band and the six plan-and-trend
 * widgets. No filter bar, no second tab, no province table — the per-province
 * and per-authority detail all lives in My Work and in the widgets below.
 *
 * THE BAND IS A FUNNEL, READ LEFT TO RIGHT. On air → drive-test done →
 * approved → remaining, each card a step of the one before it. That order is
 * the page's whole argument, so nothing else sits in the middle of it: the
 * monthly plan target is a different question (what we said we would do, not
 * what is done) and now rides with the plan-vs-actual chart it belongs to.
 *
 * Two rules still hold everywhere on this page:
 *
 * Every quantity opens the sites behind it, in a panel on the right — the
 * same panel, and the same gesture, as the Drive Test dashboard's on-air
 * figure. A figure that cannot be examined is a figure that gets argued with,
 * and a village count nobody can turn into site ids cannot be acted on.
 *
 * Counts are of every (site, village) row in the هدف universe, duplicates
 * kept — see acceptance_analytics.py. Nothing here writes, apart from the
 * PM-only monthly target inside the plan section.
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
    <AcceptanceDrillProvider>
      <PageHead eyebrow="Reports" title="Acceptance Dashboard" />
      <Overview data={data} />
    </AcceptanceDrillProvider>
  )
}

/* ---------------------------------------------------------------- Overview */

/**
 * The whole page below the head: the four KPI cards and the plan-and-trend
 * widgets.
 *
 * The KPI band borrows the Drive Test dashboard's card system wholesale
 * (`drivetest/KpiBand.jsx`, `.dt-kpi-*` in app.css) rather than keeping a
 * second, nearly-identical set of KPI cards alive: same 4-column grid, same
 * compact padding, same 3px accent edge and inline icon chip. Only the
 * accent hues differ, and those come from this page's own palette — see the
 * `data-kpi="acc-*"` blocks beside the drive test ones.
 */
function Overview({ data }) {
  const { kpis, analysis } = data
  // The head of the funnel: every target village on a live site, drive test
  // finished or not. Everything after it is a share of something narrower.
  const onair = kpis.total_onair_villages ?? 0
  const total = kpis.total_dt_done_villages
  const accepted = analysis.villages_accepted ?? analysis.villages_both_approved ?? 0
  const remaining = total - accepted
  // The two halves of remaining. Taken from the server, which partitions the
  // same population the Approved card is counted against, rather than derived
  // here from a second figure that could disagree — with a defensive fallback
  // so an older payload still adds up on screen.
  const rejected = analysis.villages_rejected ?? 0
  const remained = analysis.villages_remained ?? Math.max(0, remaining - rejected)

  const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0)
  const donePct = pct(total, onair)
  const acceptedPct = pct(accepted, total)
  const remainingPct = pct(remaining, total)

  // The two ways a village can still be outstanding, and they need different
  // people: a refusal is the programme's to answer, a wait is the province
  // office's to chase. They sit inside the Remaining card because they are
  // that number split, not two more numbers beside it.
  const parts = [
    {
      key: 'rejected',
      metric: 'rejected',
      label: 'Rejected',
      color: REJECTED,
      value: rejected,
    },
    {
      key: 'remained',
      metric: 'remained',
      label: 'Remained',
      color: PENDING,
      value: remained,
    },
  ]

  return (
    <>
      <section className="dt-kpi-band" aria-label="Acceptance totals">
        <div className="dt-kpi-card" data-kpi="acc-onair">
          <div className="dt-kpi-hd">
            <span className="dt-kpi-ic" aria-hidden="true">
              <RadioTower size={13} strokeWidth={2.2} />
            </span>
            <span className="dt-kpi-title">On air villages</span>
          </div>
          <div className="dt-kpi-v">
            <DrillFigure
              metric="onair"
              label="On air villages"
              value={onair}
              className="dt-kpi-figure tnum"
            />
          </div>
          <div className="dt-kpi-sub">Target villages on live sites</div>
        </div>

        <div className="dt-kpi-card" data-kpi="acc-total">
          <div className="dt-kpi-hd">
            <span className="dt-kpi-ic" aria-hidden="true">
              <Target size={13} strokeWidth={2.2} />
            </span>
            <span className="dt-kpi-title">DT done</span>
          </div>
          <div className="dt-kpi-v">
            <DrillFigure
              metric="dt_done"
              label="DT done villages"
              value={total}
              className="dt-kpi-figure tnum"
            />
          </div>
          <div className="dt-kpi-sub">{donePct}% of {fmtCount(onair)}</div>
          <ShareBar pct={donePct} color={ICT} />
        </div>

        <div className="dt-kpi-card" data-kpi="acc-approved">
          <div className="dt-kpi-hd">
            <span className="dt-kpi-ic" aria-hidden="true">
              <CheckCircle2 size={13} strokeWidth={2.2} />
            </span>
            <span className="dt-kpi-title">Approved</span>
          </div>
          <div className="dt-kpi-v">
            <DrillFigure
              metric="approved"
              label="Approved villages"
              value={accepted}
              className="dt-kpi-figure tnum"
            />
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
            <DrillFigure
              metric="remaining"
              label="Remaining villages"
              value={remaining}
              className="dt-kpi-figure tnum"
            />
          </div>
          <div className="dt-kpi-sub">{remainingPct}% of {fmtCount(total)}</div>
          <ShareBar pct={remainingPct} color={REJECTED} />
          {/* Both halves are named in words and figures, never by colour
              alone: red and amber are not separable under deuteranopia, and
              this is the one card whose two parts a reader must tell apart. */}
          <ul className="dt-status-list">
            {parts.map((p) => (
              <li key={p.key}>
                <DrillFigure
                  metric={p.metric}
                  label={`${p.label} villages`}
                  value={p.value}
                  className="dt-status-row"
                >
                  <span className="dt-status-name">{p.label}</span>
                  <span className="dt-status-figs">
                    <span
                      className="dt-kpi-part-dot"
                      style={{ background: p.color }}
                      aria-hidden="true"
                    />
                    <span className="dt-status-num tnum">{fmtCount(p.value)}</span>
                    <span className="dt-status-pct tnum">{pct(p.value, remaining)}%</span>
                  </span>
                </DrillFigure>
              </li>
            ))}
          </ul>
        </div>
      </section>

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
