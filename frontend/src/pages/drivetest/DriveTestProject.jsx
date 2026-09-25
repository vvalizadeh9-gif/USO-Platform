import { AlertTriangle } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import api from '../../api/client'
import { describeBlobError, filenameFrom, saveBlob } from '../../lib/download'
import { PageHead } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import AlertStrip from './AlertStrip'
import BreakdownCard, { BreakdownTabs } from './BreakdownCard'
import { DrillProvider } from './DrillPanel'
import ContractorScorecard from './ContractorScorecard'
import InfoTip from './InfoTip'
import KpiBand from './KpiBand'
import PipThisMonth from './PipThisMonth'
import ProvinceList, { ProvinceSearch } from './ProvinceList'
import Section from './Section'
import Toolbar from './Toolbar'
import FlowChart from './charts/FlowChart'
import FlowViewControl from './charts/FlowViewControl'
import { flowHasActivity, flowNotes, flowYears } from './charts/flowView'
import FlowLedger, { flowNet } from './charts/FlowLedger'
import { flowScale } from './charts/flowScale'
import { AGE_RAMP, PROVINCE_LIMIT, STATE_COLOR } from './constants'
import { count, deltaTone, TONE_COLOR } from './format'
import { ongoingLink, problematicLink } from './links'
import { useDashboard } from './useDashboard'

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

function collapse(points, limit = PROVINCE_LIMIT) {
  if (!points || points.length <= limit + 1) return points || []
  const head = points.slice(0, limit)
  const tail = points.slice(limit)
  const rest = tail.reduce((sum, p) => sum + p.value, 0)
  return [...head, { name: `${tail.length} more provinces`, value: rest, muted: true }]
}

export default function DriveTestProject() {
  const {
    overview,
    plan,
    trend,
    flow,
    provinceId,
    setProvince,
    refresh,
    refreshing,
  } = useDashboard()
  const [ongoingTab, setOngoingTab] = useState('contractor')
  const [problematicTab, setProblematicTab] = useState('category')
  // Which years the trend shows: 'all', or one Shamsi year. Held here, not
  // in the chart, because the card header shows both the control that
  // switches it and the note that describes the view.
  const [flowScope, setFlowScope] = useState('all')
  const [provinceSearch, setProvinceSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const toast = useToast()
  const provinceRef = useRef(null)

  const data = overview.data
  const provinces = useMemo(() => data?.provinces ?? [], [data])
  const provinceName = provinces.find((p) => p.id === provinceId)?.name

  const siteCount = data?.kpis?.total_onair?.value
  const subtitle = provinceName
    ? `On-air and drive-test status in ${provinceName}`
    : siteCount
      ? `Every province · ${count(siteCount)} sites`
      : 'On-air and drive-test status across your provinces'

  const has = (field) => !data || Boolean(data[field])

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
      toast.error('Export failed', await describeBlobError(err))
    } finally {
      setExporting(false)
    }
  }

  const scrollToProvinces = useCallback(() => {
    provinceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

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
        hrefFor: (p) => (p.key ? ongoingLink({ ...scope, ageBand: p.key }) : null),
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
        hrefFor: (p) => problematicLink(p.key ? { ...scope, category: p.key } : scope),
        // One bar reading "Uncategorized, 100%" looks like a finding. It is
        // the absence of one, and says so.
        note:
          b.by_category.length > 0 && b.by_category.every((p) => p.key === 'Uncategorized')
            ? 'No site has a category yet — nothing to break down until they do.'
            : undefined,
      },
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
            : 'Measured from the day each site last became problematic — a site ' +
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
    <DrillProvider>
      <PageHead
        eyebrow="Drive Test Project"
        title="Drive Test Overview"
        subtitle={subtitle}
      />

      <div className="dt-command">
        <Toolbar
          provinceId={provinceId}
          provinceName={provinceName}
          onClearProvince={() => setProvince(null)}
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
          <>
            <KpiBand kpis={data.kpis} provinceId={provinceId} />
            <AlertStrip
              kpis={data.kpis}
              provinces={data.province_breakdown}
              onScrollToProvinces={scrollToProvinces}
            />
          </>
        ) : null}

        {/* The trend and the month side by side: the chart takes the wide
            column and the month's two short answers -- what moved, and what
            was promised -- stack beside it. They used to be a full-width
            chart and then a pair of half-width cards under it, and that pair
            spent about 370px of height on what, in a month with no approved
            PIP, was mostly zeros. The chart gains from it too: it is drawn on
            a 740-unit canvas, and full width scaled its 11.5px axis labels up
            to about 18px. The column narrows it to roughly its drawn size.
            Below about 1080px of page the grid gives up the side column and
            the two short cards sit side by side under the chart instead (a
            container query on the bench, so it follows the page's width, not
            the window's). */}
        <div className="dt-grid2">
          {/* One-line header from the first frame: the control and the info
              icon arrive with the data, and a header that changed shape as
              they did would jump under the reader. The sentence that used to
              be its subtitle opens the info note. */}
          <Section
            title="Where this is going"
            inline
            state={flow}
            onRetry={refresh}
            skeletonRows={4}
            className="dt-trend-section"
            info={
              flowHasActivity(flow.data) && (
                <InfoTip label="How this chart is drawn">
                  {flowNotes(flow.data, flowScope).map((line) => (
                    <span key={line} className="dt-info-line">
                      {line}
                    </span>
                  ))}
                </InfoTip>
              )
            }
            controls={
              flowHasActivity(flow.data) && (
                <FlowViewControl
                  years={flowYears(flow.data)}
                  scope={flowScope}
                  onScope={setFlowScope}
                />
              )
            }
          >
            {(f) =>
              flowHasActivity(f) ? (
                // Keyed on the years shown, so switching resets the readout to
                // the latest month of the new view.
                <FlowChart key={String(flowScope)} data={f} scope={flowScope} />
              ) : (
                <div className="dt-empty">
                  No on-air or drive-test activity has been recorded yet. The chart fills in
                  as sites go on air and are drive-tested.
                </div>
              )
            }
          </Section>

          <div className="dt-stack">
            {trend.data?.latest_flows && (
              <Section
                title="What moved"
                subtitle={`${trend.data.latest_flows.label} ${trend.data.latest_flows.shamsi_year}${
                  trend.data.latest_flows.is_open ? ' · in progress' : ''
                }`}
                inline
                state={trend}
                onRetry={refresh}
                skeletonRows={3}
                actions={<NetChange value={flowNet(trend.data.latest_flows)} />}
                info={
                  <InfoTip label="How What moved is counted">
                    Completions are counted directly. Arrivals are derived from the balances.
                    Problem flags and resolutions are counted where the platform dates the
                    change and reconciled against the balances where it does not. The scale
                    starts at {count(flowScale(trend.data.latest_flows).floor)}, not zero.
                  </InfoTip>
                }
                className="dt-flow-section"
              >
                {(t) => <FlowLedger flows={t.latest_flows} monthLabel={t.latest_flows.label} />}
              </Section>
            )}

            <PipThisMonth
              state={plan}
              onRetry={refresh}
              scoped={provinceId != null}
              provinceName={provinceName}
            />
          </div>
        </div>

        <div className="dt-pair">
          {has('ongoing_breakdown') && (
            <Section
              title="Ongoing breakdown"
              state={overview}
              onRetry={refresh}
              actions={
                data && (
                  <SectionTotal
                    value={data.ongoing_breakdown.total}
                    label="ongoing"
                    color={STATE_COLOR.ongoing}
                  />
                )
              }
              controls={
                <BreakdownTabs
                  idBase="dt-ongoing"
                  tabs={ONGOING_TABS}
                  tab={ongoingTab}
                  onTab={setOngoingTab}
                />
              }
            >
              {(d) => (
                <BreakdownCard
                  idBase="dt-ongoing"
                  tab={ongoingTab}
                  views={ongoingViews}
                  total={d.ongoing_breakdown.total}
                />
              )}
            </Section>
          )}

          {has('problematic_breakdown') && (
            <Section
              title="Problematic breakdown"
              state={overview}
              onRetry={refresh}
              actions={
                data && (
                  <SectionTotal
                    value={data.problematic_breakdown.total}
                    label="problematic"
                    color={STATE_COLOR.problematic}
                  />
                )
              }
              controls={
                <BreakdownTabs
                  idBase="dt-problematic"
                  tabs={PROBLEMATIC_TABS}
                  tab={problematicTab}
                  onTab={setProblematicTab}
                />
              }
            >
              {(d) => (
                <BreakdownCard
                  idBase="dt-problematic"
                  tab={problematicTab}
                  views={problematicViews}
                  total={d.problematic_breakdown.total}
                />
              )}
            </Section>
          )}
        </div>

        {/* The two tables, stacked: side by side they do not fit this
            page's width without hiding columns -- measured, see app.css. */}
        <div className="dt-tables">
          {has('contractor_scorecard') && (
            <Section
              title="Contractor scorecard"
              inline
              state={overview}
              onRetry={refresh}
              info={
                <InfoTip label="What the scorecard counts">
                  <span className="dt-info-line">
                    Assignment = DT done + Ongoing. Problematic sites are not part of a
                    contractor&rsquo;s assignment: a site in a problem category has not been
                    handed to them, and counting it would mark a company down for work the
                    programme never gave it.
                  </span>
                  <span className="dt-info-line">
                    PIP plan and Achieved are this month&rsquo;s approved plan and what was
                    delivered against it.
                  </span>
                </InfoTip>
              }
            >
              {(d) => (
                <ContractorScorecard
                  rows={d.contractor_scorecard}
                  plan={plan.data}
                  provinceId={provinceId}
                />
              )}
            </Section>
          )}

          {has('province_breakdown') && (
            <div ref={provinceRef} className="dt-tables-cell">
              <Section
                title="Drive Test Progress by Province"
                inline
                state={overview}
                onRetry={refresh}
                info={
                  <InfoTip label="How the province table reads">
                    <span className="dt-info-line">
                      Gap = On air − DT Done. Ongoing + Problematic can be lower than Gap,
                      because on-air sites with no DT status yet are counted in Gap only.
                    </span>
                    <span className="dt-info-line">
                      Sort any column; click a row to narrow the whole dashboard to that
                      province.
                    </span>
                  </InfoTip>
                }
                controls={<ProvinceSearch value={provinceSearch} onChange={setProvinceSearch} />}
              >
                {(d) => (
                  <ProvinceList
                    rows={d.province_breakdown}
                    provinces={d.provinces}
                    onProvince={setProvince}
                    search={provinceSearch}
                  />
                )}
              </Section>
            </div>
          )}
        </div>
      </div>
    </DrillProvider>
  )
}

function NetChange({ value }) {
  if (value == null) return null
  const tone = deltaTone(value, 'down')
  return (
    <span className="dt-section-total">
      <b className="tnum" style={{ color: tone ? TONE_COLOR[tone] : TONE_COLOR.flat }}>
        {value > 0 ? '+' : ''}
        {count(value)}
      </b>
      <span>net</span>
    </span>
  )
}

function SectionTotal({ value, label, color }) {
  return (
    <span className="dt-section-total">
      <i className="dt-section-dot" style={{ background: color }} aria-hidden="true" />
      <b className="tnum" style={{ color }}>{count(value)}</b>
      <span>{label}</span>
    </span>
  )
}

function KpiSkeleton() {
  return (
    <div className="dt-kpi-band dt-kpi-skeleton" aria-hidden="true">
      <span className="dt-skeleton-row" style={{ height: 148 }} />
      <span className="dt-skeleton-row" style={{ height: 148, animationDelay: '0.08s' }} />
      <span className="dt-skeleton-row" style={{ height: 148, animationDelay: '0.16s' }} />
      <span className="dt-skeleton-row" style={{ height: 148, animationDelay: '0.24s' }} />
    </div>
  )
}
