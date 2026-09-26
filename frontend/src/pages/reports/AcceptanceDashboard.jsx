import { useEffect, useState } from 'react'
import api from '../../api/client'
import { Loading, PageHead } from '../../components/ui'
import AcceptancePlanSection from './AcceptancePlanSection'
import { AcceptanceDrillProvider, DrillFigure } from './AcceptanceDrillPanel'
import InfoTip from '../drivetest/InfoTip'
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
    // `.acc-page` scopes this page's type ramp (see app.css) — the drill
    // panel included, which is why the provider sits inside it.
    <div className="acc-page">
      <AcceptanceDrillProvider>
        <PageHead eyebrow="Reports" title="Acceptance Dashboard" />
        <Overview data={data} />
      </AcceptanceDrillProvider>
    </div>
  )
}

/* ---------------------------------------------------------------- Overview */

/**
 * The whole page below the head: the four KPI cards and the plan-and-trend
 * widgets.
 *
 * The KPI band sits on the Drive Test dashboard's card shell
 * (`.dt-kpi-card` in app.css), and every card is built the same way: colour
 * dot + title → figure → one context line → progress bar → a foot row with a
 * label on the left and a value on the right. No icon tiles, and no
 * breakdown row on any card — the band is four numbers and what each is a
 * share of.
 *
 * Colour carries one meaning each: green is fully accepted and nothing else,
 * amber is still outstanding, and red is kept for a refusal (the ICT/CRA
 * comparison below). On air and DT done are denominators, not states, so
 * they take neutrals.
 */
function Overview({ data }) {
  const { kpis, analysis } = data
  // The head of the funnel: every هدف village on a live site, drive test
  // finished or not, split by how it was launched. Everything after it is a
  // share of something narrower.
  const onair = kpis.total_onair_villages ?? 0
  const permanent = kpis.total_onair_permanent ?? 0
  const temporary = kpis.total_onair_temporary ?? 0
  const total = kpis.total_dt_done_villages
  const accepted = analysis.villages_accepted ?? analysis.villages_both_approved ?? 0
  const remaining = total - accepted
  // On-air villages whose drive test is not finished. Floored at zero: the
  // DT-done universe is not filtered on launch status, so on a data set where
  // it outgrows the on-air count this reads "0", never a negative.
  const notTested = Math.max(0, onair - total)

  const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0)
  const donePct = pct(total, onair)
  const acceptedPct = pct(accepted, total)
  const remainingPct = pct(remaining, total)

  return (
    <>
      <section className="dt-kpi-band" aria-label="Acceptance totals">
        <KpiCard
          kpi="acc-onair"
          title="Total on-air villages"
          tip="هدف villages that are on air — راه اندازی دائم or موقت. Villages not yet on air are outside this count."
          metric="onair"
          drillLabel="On-air villages"
          value={onair}
          context="هدف · راه اندازی دائم + موقت"
          bar={[
            { pct: pct(permanent, onair), color: 'var(--text-muted)' },
            { pct: pct(temporary, onair), color: 'var(--dt-notstarted)' },
          ]}
          // Each Persian label is isolated (<bdi>) so the bidi algorithm
          // cannot move the figure to the other side of it: label, then
          // value, like the other three cards' feet.
          foot={[
            <><bdi>دائم</bdi> <b className="tnum">{fmtCount(permanent)}</b></>,
            <><bdi>موقت</bdi> <b className="tnum">{fmtCount(temporary)}</b></>,
          ]}
        />
        <KpiCard
          kpi="acc-total"
          title="Total DT done villages"
          tip="هدف villages with a completed drive test. Every other figure on this page is measured against this number."
          metric="dt_done"
          drillLabel="DT done villages"
          value={total}
          context="Drive test complete"
          bar={[{ pct: donePct, color: 'var(--kpi-accent)' }]}
          foot={[
            `${donePct}% of on-air`,
            <><b className="tnum">{fmtCount(notTested)}</b> not tested</>,
          ]}
        />
        <KpiCard
          kpi="acc-approved"
          title="Fully accepted"
          tip="Villages approved by both ICT and CRA on every requested technology."
          metric="approved"
          drillLabel="Fully accepted villages"
          value={accepted}
          context="ICT and CRA both approved"
          bar={[{ pct: acceptedPct, color: 'var(--kpi-accent)' }]}
          foot={[
            `${acceptedPct}% of DT done`,
            <><b className="tnum">{fmtCount(accepted)}</b> of {fmtCount(total)}</>,
          ]}
        />
        <KpiCard
          kpi="acc-remaining"
          title="Remaining"
          tip="DT-done villages still missing ICT approval, CRA approval, or both."
          metric="remaining"
          drillLabel="Remaining villages"
          value={remaining}
          context="Missing ICT, CRA or both"
          bar={[{ pct: remainingPct, color: 'var(--kpi-accent)' }]}
          foot={[
            `${remainingPct}% of DT done`,
            <><b className="tnum">{fmtCount(remaining)}</b> of {fmtCount(total)}</>,
          ]}
        />
      </section>

      <AcceptancePlanSection total={total} analysis={analysis} kpis={kpis} />
    </>
  )
}

/**
 * One card of the band. Every card is the same five rows, in the same order,
 * so a reader who has learned one has learned all four.
 *
 * `bar` is one or more segments, each a share of the track; the rest of the
 * track is the band's neutral. It is decorative — the foot row says the same
 * in words and figures — so it is hidden from assistive technology.
 */
function KpiCard({ kpi, title, tip, metric, drillLabel, value, context, bar, foot }) {
  return (
    <div className="dt-kpi-card" data-kpi={kpi}>
      <div className="dt-kpi-hd">
        <span className="dt-kpi-dot" aria-hidden="true" />
        <span className="dt-kpi-title">{title}</span>
        <InfoTip label={`About ${title}`}>{tip}</InfoTip>
      </div>
      <div className="dt-kpi-v">
        <DrillFigure
          metric={metric}
          label={drillLabel}
          value={value}
          className="dt-kpi-figure tnum"
        />
      </div>
      <div className="dt-kpi-sub">{context}</div>
      <div className="dt-kpi-split" role="presentation" aria-hidden="true">
        {bar.map((seg, i) => (
          <i key={i} style={{ width: `${seg.pct}%`, background: seg.color }} />
        ))}
      </div>
      <div className="acc-kpi-foot">
        <span>{foot[0]}</span>
        <span>{foot[1]}</span>
      </div>
    </div>
  )
}
