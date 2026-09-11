import { AlertTriangle, CircleDashed } from 'lucide-react'
import { useMemo, useState } from 'react'
import api from '../../api/client'
import { PageHead } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
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
import { count } from './format'
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

  const ongoingViews = useMemo(() => {
    const b = data?.ongoing_breakdown
    if (!b) return {}
    return {
      contractor: {
        points: b.by_contractor,
        unit: 'Contractor',
        color: 'var(--signal)',
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
        note:
          b.without_launch_date > 0
            ? `Measured from each site's launch date. ${count(b.without_launch_date)} ongoing ` +
              `${b.without_launch_date === 1 ? 'site has' : 'sites have'} no launch date recorded ` +
              'and cannot be aged.'
            : "Measured from each site's launch date — how long a live site has gone untested.",
      },
    }
  }, [data, provinces])

  const problematicViews = useMemo(() => {
    const b = data?.problematic_breakdown
    if (!b) return {}
    return {
      category: {
        points: b.by_category,
        unit: 'Category',
        color: 'var(--red)',
        hrefFor: () => problematicLink(provinceId == null ? {} : { provinceId }),
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

      <PlanDelivery state={plan} onRetry={refresh} />

      {has('ongoing_breakdown') && (
      <div className="dt-pair">
      <Section
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
