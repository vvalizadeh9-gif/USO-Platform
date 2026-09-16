import { AlertTriangle, CircleDashed } from 'lucide-react'
import { useMemo, useState } from 'react'
import api from '../../api/client'
import { PageHead } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import BenchRail from './BenchRail'
import BreakdownCard from './BreakdownCard'
import ContractorScorecard from './ContractorScorecard'
import KpiBand from './KpiBand'
import PlanDelivery from './PlanDelivery'
import ProvinceTable from './ProvinceTable'
import Section from './Section'
import Toolbar from './Toolbar'
import FlowLedger from './charts/FlowLedger'
import StagePipeline from './charts/StagePipeline'
import TrendChart from './charts/TrendChart'
import { PROVINCE_LIMIT, TREND_SERIES } from './constants'
import { achievement, count } from './format'
import { ongoingLink, problematicLink } from './links'
import { useDashboard } from './useDashboard'

/**
 * The Drive Test dashboard.
 *
 * Read top to bottom it answers four questions in order: where does the
 * programme stand, which way is it going, what moved this month, and where is
 * the outstanding work. The old page answered only the first, then repeated
 * it in eight identically-weighted cards.
 *
 * Everything here that could name a contractor or reach a site is scoped by
 * the endpoints, not by this component. The province filter narrows what is
 * already visible and can never widen it — see
 * `api/drive_test._resolve_province`.
 *
 * THE WORKBENCH LAYOUT. The four questions are still answered in that order —
 * the order is the argument and it has not changed. What changed is that the
 * page stopped being a document you read once and became a surface you work
 * at, because that is what it is used for: every figure on it is a link to the
 * sites behind it (`/drive-test/sites`), so the reader arrives, drills
 * through, comes back, and re-filters.
 *
 * That use is what the two moves here serve. The command bar sticks, so the
 * province filter and the freshness clock stay reachable from the bottom of a
 * three-screen page instead of being stranded at the top. The bench rail says
 * which panels exist, what each one's headline figure is, and which one you
 * are in. The panels themselves are unchanged, pairing included.
 *
 * Source order is unchanged and is load-bearing: the rail, the panel grid and
 * the reading order are all driven by `panels` below, and the grid places by
 * source order rather than by explicit track assignment. A panel added to
 * `panels` therefore appears in the rail and on the bench in the one place.
 */

const ONGOING_TABS = [
  { key: 'contractor', label: 'Contractor' },
  { key: 'province', label: 'Province' },
  { key: 'age', label: 'How long waiting' },
]

const PROBLEMATIC_TABS = [
  { key: 'category', label: 'Category' },
  { key: 'province', label: 'Province' },
]

const TREND_LABELS = Object.fromEntries(TREND_SERIES.map((s) => [s.key, s.label]))

/** Anchor ids for the panels, shared by the bench rail and the panels
 * themselves. Named here rather than written twice, because a rail entry whose
 * id has drifted from its panel's is a link that silently goes nowhere. */
const PANEL = {
  plan: 'dt-panel-plan',
  ongoing: 'dt-panel-ongoing',
  stuck: 'dt-panel-stuck',
  problematic: 'dt-panel-problematic',
  contractors: 'dt-panel-contractors',
  provinces: 'dt-panel-provinces',
  trend: 'dt-panel-trend',
  flow: 'dt-panel-flow',
}

/** Top `limit` points with the tail folded into one line.
 *
 * The remainder line is not decoration — it is what keeps a truncated view
 * summing to its total. Dropping the tail would make a partial list read as a
 * complete one.
 */
function collapse(points, limit = PROVINCE_LIMIT) {
  if (!points || points.length <= limit + 1) return points || []
  const head = points.slice(0, limit)
  const tail = points.slice(limit)
  const rest = tail.reduce((sum, p) => sum + p.value, 0)
  return [...head, { name: `${tail.length} more provinces`, value: rest, muted: true }]
}

export default function DriveTestProject() {
  const { overview, plan, trend, provinceId, setProvince, refresh, refreshing } = useDashboard()
  const [ongoingTab, setOngoingTab] = useState('contractor')
  const [problematicTab, setProblematicTab] = useState('category')
  const [exporting, setExporting] = useState(false)
  const toast = useToast()

  const data = overview.data
  // Memoised because two useMemos below depend on it, and a fresh []
  // every render would rebuild both on every render.
  const provinces = useMemo(() => data?.provinces ?? [], [data])
  const provinceName = provinces.find((p) => p.id === provinceId)?.name

  const monthName = data?.current_month_label?.split(' ')[0] ?? ''

  /** Whether a section that depends on one payload field should be on screen.
   *
   * Present while the request is in flight or has failed, so the section can
   * show its own skeleton or its own error. Gone once a payload has arrived
   * without the field — an older backend, or one that dropped it — which is
   * the same contract the page this replaces had: a section that cannot be
   * drawn is not drawn, and nothing around it is affected. */
  const has = (field) => !data || Boolean(data[field])

  async function exportSites() {
    setExporting(true)
    try {
      const res = await api.get('/work-items/export', {
        params: provinceId == null ? {} : { province_id: provinceId },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = provinceName ? `drive_test_${provinceName}.xlsx` : 'drive_test_sites.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed', 'Could not generate the file. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  /** Contractor name -> id, for the ongoing breakdown's bars.
   *
   * Those points carry a name and a count and no id, so the id comes from the
   * scorecard in the same payload — the one place this page already has both.
   * A name with no row is not linked, which is exactly what should happen to
   * the unnamed "Other contractors" aggregate a contractor account sees: it
   * stands for several companies and there is no list behind it that they are
   * allowed to open.
   */
  const contractorIdByName = useMemo(() => {
    const map = new Map()
    for (const row of data?.contractor_scorecard ?? []) {
      if (row.contractor_id != null) map.set(row.name, row.contractor_id)
    }
    return map
  }, [data])

  const ongoingViews = useMemo(() => {
    const b = data?.ongoing_breakdown
    if (!b) return {}
    const scope = provinceId == null ? {} : { provinceId }
    return {
      contractor: {
        points: b.by_contractor,
        unit: 'Contractor',
        color: 'var(--signal)',
        hrefFor: (p) => {
          const id = contractorIdByName.get(p.name)
          return id == null ? null : ongoingLink({ ...scope, contractorId: id })
        },
        // Stated rather than left to be inferred from a total that does not
        // match: sites with no contractor are deliberately not a bar here.
        note:
          b.without_contractor > 0
            ? `${count(b.without_contractor)} ongoing ${
                b.without_contractor === 1 ? 'site has' : 'sites have'
              } no contractor and are not shown above.`
            : 'Every ongoing site has a contractor.',
      },
      province: {
        points: collapse(b.by_province),
        unit: 'Province',
        color: 'var(--signal)',
        hrefFor: (p) => {
          const id = provinces.find((x) => x.name === p.name)?.id
          return id ? ongoingLink({ provinceId: id }) : null
        },
      },
      age: {
        points: b.by_age,
        unit: 'Waiting',
        color: 'var(--amber)',
        // The band's key, not its label: the label carries an en dash and is
        // a wording somebody may improve, and a URL built out of it would
        // break silently — with an empty list rather than an error.
        hrefFor: (p) => (p.key ? ongoingLink({ ...scope, ageBand: p.key }) : null),
        note:
          b.without_launch_date > 0
            ? `Measured from each site's launch date. ${count(b.without_launch_date)} ongoing ` +
              `${b.without_launch_date === 1 ? 'site has' : 'sites have'} no launch date recorded ` +
              'and cannot be aged.'
            : "Measured from each site's launch date — how long a live site has gone untested.",
      },
    }
  }, [data, provinces, provinceId, contractorIdByName])

  const problematicViews = useMemo(() => {
    const b = data?.problematic_breakdown
    if (!b) return {}
    return {
      category: {
        points: b.by_category,
        unit: 'Category',
        color: 'var(--red)',
        // Each bar opens its own category. It used to open every problematic
        // site whichever bar was clicked, so a reader who clicked 64 landed
        // on 194.
        hrefFor: (p) => {
          const scope = provinceId == null ? {} : { provinceId }
          return problematicLink(p.key ? { ...scope, category: p.key } : scope)
        },
      },
      province: {
        points: collapse(b.by_province),
        unit: 'Province',
        color: 'var(--red)',
        hrefFor: (p) => {
          const id = provinces.find((x) => x.name === p.name)?.id
          return id ? problematicLink({ provinceId: id }) : null
        },
      },
    }
  }, [data, provinces, provinceId])

  /** The rail's entries, and the reading order of the bench.
   *
   * Built from the same `has` conditions the panels themselves are rendered
   * under, so a panel an older backend does not serve is absent from both. It
   * lists every panel while the payload is still in flight — `has` is true
   * with no data — which keeps the rail from reshuffling under the pointer as
   * the sections land.
   *
   * Only three entries carry a figure. Every figure in this column has to be
   * readable against the ones above and below it, and the honest headline for
   * the scorecard or the province table is a count of contractors or of
   * provinces — a different unit sitting in the same column as counts of
   * sites. A column that silently changes unit is worse than a column with
   * gaps in it, so those entries are named only.
   */
  const panels = useMemo(() => {
    const items = [
      {
        id: PANEL.plan,
        label: 'Plan and delivery',
        figure: plan.data ? achievement(plan.data.achievement_percent) : null,
        color: 'var(--violet)',
      },
    ]
    if (has('ongoing_breakdown')) {
      items.push({
        id: PANEL.ongoing,
        label: 'Ongoing breakdown',
        figure: data ? count(data.ongoing_breakdown.total) : null,
        color: 'var(--signal-strong)',
      })
      items.push({ id: PANEL.stuck, label: 'Where it is stuck' })
    }
    if (has('problematic_breakdown')) {
      items.push({
        id: PANEL.problematic,
        label: 'Problematic breakdown',
        figure: data ? count(data.problematic_breakdown.total) : null,
        color: 'var(--red)',
      })
    }
    if (has('contractor_scorecard')) {
      items.push({ id: PANEL.contractors, label: 'Contractor scorecard' })
    }
    if (has('province_breakdown')) {
      items.push({ id: PANEL.provinces, label: 'Province breakdown' })
    }
    items.push({ id: PANEL.trend, label: 'Where this is going' })
    if (trend.data?.latest_flows) {
      items.push({ id: PANEL.flow, label: 'What moved' })
    }
    return items
    // `has` closes over `data` and is redefined each render; depending on
    // `data` directly is the same condition without the churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, plan.data, trend.data])

  return (
    <>
      <PageHead
        eyebrow="Drive Test Project"
        title="Drive Test Overview"
        subtitle={
          provinceName
            ? `On-air and drive-test status in ${provinceName}`
            : 'On-air and drive-test status across your provinces'
        }
      />

      {/* The command bar sticks. Everything in it changes what the page
          shows, and the page is three screens long; a filter you have to
          scroll back to the top to reach is a filter that gets used once. The
          freshness clock has the same problem in reverse — it is only honest
          while it is on screen. */}
      <div className="dt-command">
        <Toolbar
          provinces={provinces}
          provinceId={provinceId}
          onProvince={setProvince}
          onRefresh={refresh}
          refreshing={refreshing}
          generatedAt={data?.generated_at}
          onExport={exportSites}
          exporting={exporting}
        />
      </div>

      <div className="dt-workbench">
        <BenchRail items={panels} />

        <div className="dt-bench">
      {overview.error ? (
        <div className="dt-page-error card card-pad" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <b>Could not load the Drive Test figures.</b>
            <p>Everything on this page comes from that request, so there is nothing to show.</p>
          </div>
          <button type="button" className="btn" onClick={refresh}>
            Try again
          </button>
        </div>
      ) : overview.loading && !data ? (
        <KpiSkeleton />
      ) : data ? (
        <KpiBand kpis={data.kpis} monthName={monthName} provinceId={provinceId} />
      ) : null}

      <PlanDelivery id={PANEL.plan} state={plan} onRetry={refresh} />

      {has('ongoing_breakdown') && (
      <div className="dt-pair">
      <Section
        id={PANEL.ongoing}
        title="Ongoing breakdown"
        state={overview}
        onRetry={refresh}
        actions={
          data && (
            <SectionTotal
              icon={CircleDashed}
              value={data.ongoing_breakdown.total}
              label="ongoing"
              color="var(--signal-strong)"
            />
          )
        }
      >
        {(d) => (
          <BreakdownCard
            tabs={ONGOING_TABS}
            tab={ongoingTab}
            onTab={setOngoingTab}
            views={ongoingViews}
            total={d.ongoing_breakdown.total}
          />
        )}
      </Section>
      <Section
        id={PANEL.stuck}
        title="Where the ongoing work is stuck"
        subtitle="In workflow order — who each site is waiting on"
        state={overview}
        onRetry={refresh}
      >
        {(d) => (
          <StagePipeline
            points={d.ongoing_breakdown.by_stage}
            total={d.ongoing_breakdown.total}
            provinceId={provinceId}
          />
        )}
      </Section>
      </div>
      )}

      {has('problematic_breakdown') && (
      <Section
        id={PANEL.problematic}
        title="Problematic breakdown"
        state={overview}
        onRetry={refresh}
        actions={
          data && (
            <SectionTotal
              icon={AlertTriangle}
              value={data.problematic_breakdown.total}
              label="problematic"
              color="var(--red)"
            />
          )
        }
      >
        {(d) => (
          <BreakdownCard
            tabs={PROBLEMATIC_TABS}
            tab={problematicTab}
            onTab={setProblematicTab}
            views={problematicViews}
            total={d.problematic_breakdown.total}
          />
        )}
      </Section>
      )}

      {has('contractor_scorecard') && (
      <Section
        id={PANEL.contractors}
        title="Contractor scorecard"
        subtitle="Ranked by how far through its own book of work each company is"
        state={overview}
        onRetry={refresh}
      >
        {(d) => (
          <ContractorScorecard rows={d.contractor_scorecard} provinceId={provinceId} />
        )}
      </Section>
      )}

      {has('province_breakdown') && (
      <Section
        id={PANEL.provinces}
        title="Province breakdown"
        subtitle="Sort any column; filter the whole dashboard from a row"
        state={overview}
        onRetry={refresh}
      >
        {(d) => (
          <ProvinceTable
            rows={d.province_breakdown}
            provinces={d.provinces}
            onProvince={setProvince}
          />
        )}
      </Section>
      )}

      <Section
        id={PANEL.trend}
        title="Where this is going"
        subtitle={
          trend.data?.months?.length
            ? `Last ${trend.data.months.length} months, ending this one`
            : undefined
        }
        state={trend}
        onRetry={refresh}
        skeletonRows={6}
        className="dt-section-trend"
      >
        {(t) =>
          t.months?.some((m) => m.captured) ? (
            <>
              <TrendChart months={t.months} seriesLabel={TREND_LABELS} />
              <TrendLegend />
            </>
          ) : (
            <div className="dt-empty">
              No monthly snapshots have been captured yet. The series fills in as the
              months are recorded.
            </div>
          )
        }
      </Section>

      {trend.data?.latest_flows && (
        <Section
          id={PANEL.flow}
          title="What moved"
          subtitle={`${trend.data.latest_flows.label} ${trend.data.latest_flows.shamsi_year}${
            trend.data.latest_flows.is_open ? ' · still in progress' : ''
          }`}
          state={trend}
          onRetry={refresh}
          className="dt-section-flow"
        >
          {(t) => (
            <FlowLedger flows={t.latest_flows} monthLabel={t.latest_flows.label} />
          )}
        </Section>
      )}
        </div>
      </div>
    </>
  )
}

function SectionTotal({ icon: Icon, value, label, color }) {
  return (
    <span className="dt-section-total">
      <Icon size={15} strokeWidth={2} style={{ color }} aria-hidden="true" />
      <b className="tnum">{count(value)}</b>
      <span>{label}</span>
    </span>
  )
}

function TrendLegend() {
  return (
    <div className="dt-legend">
      {TREND_SERIES.map((s) => (
        <span key={s.key} className="dt-legend-item">
          <i style={{ background: s.color }} aria-hidden="true" />
          {s.label}
          {s.key === 'problematic' && <em>own scale</em>}
        </span>
      ))}
      <span className="dt-legend-item dt-legend-note">
        <i className="dt-legend-hollow" aria-hidden="true" />
        provisional or estimated reading
      </span>
    </div>
  )
}

function KpiSkeleton() {
  return (
    <div className="dt-band dt-band-skeleton" aria-hidden="true">
      <span className="dt-skeleton-row" style={{ width: '40%', height: 30 }} />
      <span className="dt-skeleton-row" style={{ height: 46, animationDelay: '0.08s' }} />
      <span className="dt-skeleton-row" style={{ width: '60%', animationDelay: '0.16s' }} />
    </div>
  )
}
