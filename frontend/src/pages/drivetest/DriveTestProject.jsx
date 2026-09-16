import { AlertTriangle, CircleDashed } from 'lucide-react'
import { useMemo, useState } from 'react'
import api from '../../api/client'
import { describeBlobError, filenameFrom, saveBlob } from '../../lib/download'
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
import TrendChart from './charts/TrendChart'
import { AGE_RAMP, PROVINCE_LIMIT, STATE_COLOR, TREND_SERIES } from './constants'
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
 *
 * TWO THINGS THIS PAGE NO LONGER HAS, and both were removed for the same
 * reason — they were furniture the reader had to learn before they could read
 * anything.
 *
 * The first was a side rail listing the panels with their headline figures.
 * It was answering "how far down am I" on a page that is only long because
 * nothing on it had been made compact, and it duplicated every figure it
 * listed: a reader was given the ongoing total twice, four hundred pixels
 * apart, with nothing saying they were the same number. Shrinking the trend
 * and the ledger took the page to a length a scrollbar handles on its own.
 *
 * The second was "where the ongoing work is stuck", a stage pipeline beside
 * the ongoing breakdown. Its buckets are workflow stages — a vocabulary that
 * belongs to the health-check and assignment screens, where acting on them is
 * possible. Here it was a fourth way of cutting the same ongoing total, and
 * the one nobody on this page could do anything with.
 *
 * EVERY SECTION IS A CARD. Not because cards are decoration, but because this
 * page is read in pieces: a reader comes for the scorecard or the provinces,
 * not for a document. The rule is one card, one question, one heading — and
 * the weight is spent evenly, because after the hero nothing here is more
 * important than anything else.
 */

const ONGOING_TABS = [
  { key: 'contractor', label: 'Contractor' },
  { key: 'province', label: 'Province' },
  { key: 'age', label: 'How long' },
]

const PROBLEMATIC_TABS = [
  { key: 'category', label: 'Category' },
  { key: 'age', label: 'How long' },
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

  /** Download the DT delivery workbook for what is currently on screen.
   *
   * This used to fetch `/work-items/export`, which is a different set: every
   * work item in scope, on-air or not, with five columns. A reader pressed
   * Export on this dashboard and got a file whose row count matched no figure
   * on the page — the one thing the drill-through exists to prevent, left in
   * the toolbar. It now asks for the workbook, which is built from these very
   * figures.
   *
   * The saved filename comes from the server where it sends one: the backend
   * already builds a dated, scope-named, ASCII-safe name, and inventing a
   * second one here is how the two come to disagree.
   *
   * Saving and failing are both `lib/download`'s job, because the site list
   * does exactly this and had exactly the same two bugs.
   */
  async function exportWorkbook() {
    setExporting(true)
    try {
      const res = await api.get('/drive-test/export', {
        params: provinceId == null ? {} : { province_id: provinceId },
        responseType: 'blob',
      })
      saveBlob(
        res.data,
        filenameFrom(
          res.headers,
          provinceName ? `dt-delivery-${provinceName}.xlsx` : 'dt-delivery.xlsx',
        ),
      )
    } catch (err) {
      // What actually went wrong, not "try again". The body of a failed
      // request made with `responseType: 'blob'` is a Blob, so the reason the
      // server gave has to be read back out of it -- see `lib/download`.
      toast.error('Export failed', await describeBlobError(err))
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
   * stands for several companies and there is no list behind it they are
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
        color: STATE_COLOR.ongoing,
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
        color: STATE_COLOR.ongoing,
        hrefFor: (p) => {
          const id = provinces.find((x) => x.name === p.name)?.id
          return id ? ongoingLink({ provinceId: id }) : null
        },
      },
      age: {
        points: b.by_age,
        unit: 'Held for',
        // The band's key, not its label: the labels carry en dashes and are
        // wordings somebody may improve, and a URL built out of one would
        // break silently — with an empty list rather than an error.
        hrefFor: (p) => (p.key ? ongoingLink({ ...scope, ageBand: p.key }) : null),
        // The one ramp on the page: these bands are an ordered scale, so the
        // longer a site has been held the heavier its bar reads.
        color: (_point, i) => AGE_RAMP[Math.min(i, AGE_RAMP.length - 1)],
        note:
          b.without_assignment_date > 0
            ? `Measured from the day each site was assigned to a contractor. ` +
              `${count(b.without_assignment_date)} ongoing ` +
              `${b.without_assignment_date === 1 ? 'site is' : 'sites are'} not assigned to ` +
              'anyone yet, so no clock has started on them and they are not shown above.'
            : 'Measured from the day each site was assigned to a contractor — how long the ' +
              'company holding it now has held it.',
      },
    }
  }, [data, provinces, provinceId, contractorIdByName])

  const problematicViews = useMemo(() => {
    const b = data?.problematic_breakdown
    if (!b) return {}
    const scope = provinceId == null ? {} : { provinceId }
    return {
      category: {
        points: b.by_category,
        unit: 'Category',
        color: STATE_COLOR.problematic,
        // Each bar opens its own category. It used to open every problematic
        // site whichever bar was clicked, so a reader who clicked 64 landed
        // on 194.
        hrefFor: (p) => problematicLink(p.key ? { ...scope, category: p.key } : scope),
      },
      // How long each of these has been a problem. The category split says
      // what is wrong and cannot say whether it is this week's news or last
      // year's, and only the second is somebody's to answer for. Same bands
      // as the ongoing card, on a different clock: the day each site last
      // entered the state.
      age: {
        points: b.by_age,
        unit: 'Stuck for',
        hrefFor: (p) => (p.key ? problematicLink({ ...scope, ageBand: p.key }) : null),
        color: (_point, i) => AGE_RAMP[Math.min(i, AGE_RAMP.length - 1)],
        note:
          b.without_problem_date > 0
            ? `Measured from the day each site last became problematic. ` +
              `${count(b.without_problem_date)} ` +
              `${b.without_problem_date === 1 ? 'site was' : 'sites were'} flagged by a ` +
              'CPM import, which records no date, so no clock has started on them and they ' +
              'are not shown above.'
            : 'Measured from the day each site last became problematic \u2014 a site ' +
              'flagged, fixed and flagged again is aged from the latest flag.',
      },
      province: {
        points: collapse(b.by_province),
        unit: 'Province',
        color: STATE_COLOR.problematic,
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

      {/* The command bar sticks. Everything in it changes what the page
          shows, and the page is long enough to scroll; a filter you have to
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
          onExport={exportWorkbook}
          exporting={exporting}
        />
      </div>

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

        <PlanDelivery state={plan} onRetry={refresh} />

        <div className="dt-pair">
          {has('ongoing_breakdown') && (
            <Section
              title="Ongoing breakdown"
              subtitle="Sites in flight, cut three ways"
              state={overview}
              onRetry={refresh}
              actions={
                data && (
                  <SectionTotal
                    icon={CircleDashed}
                    value={data.ongoing_breakdown.total}
                    label="ongoing"
                    color={STATE_COLOR.ongoing}
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
          )}

          {has('problematic_breakdown') && (
            <Section
              title="Problematic breakdown"
              subtitle="Sites the programme is blocked on, and how long each has been"
              state={overview}
              onRetry={refresh}
              actions={
                data && (
                  <SectionTotal
                    icon={AlertTriangle}
                    value={data.problematic_breakdown.total}
                    label="problematic"
                    color={STATE_COLOR.problematic}
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
        </div>

        {has('contractor_scorecard') && (
          <Section
            title="Contractor scorecard"
            subtitle="Assignment is drive tests done plus sites still held — problematic sites are not assigned work"
            state={overview}
            onRetry={refresh}
          >
            {(d) => <ContractorScorecard rows={d.contractor_scorecard} provinceId={provinceId} />}
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

        <div className="dt-pair">
          <Section
            title="Where this is going"
            subtitle={
              trend.data?.months?.length
                ? `Last ${trend.data.months.length} months, ending this one`
                : undefined
            }
            state={trend}
            onRetry={refresh}
            skeletonRows={4}
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
              skeletonRows={4}
            >
              {(t) => <FlowLedger flows={t.latest_flows} monthLabel={t.latest_flows.label} />}
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
    <div className="dt-hero dt-hero-skeleton" aria-hidden="true">
      <span className="dt-skeleton-ring" />
      <div className="dt-hero-body">
        <span className="dt-skeleton-row" style={{ height: 66 }} />
        <span className="dt-skeleton-row" style={{ width: '60%', animationDelay: '0.16s' }} />
      </div>
    </div>
  )
}
