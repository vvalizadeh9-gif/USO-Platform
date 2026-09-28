import {
  ArrowLeftRight,
  Building2,
  Hourglass,
  MapPinned,
  OctagonAlert,
  TrendingUp,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../../api/client'
import { describeBlobError, filenameFrom, saveBlob } from '../../lib/download'
import { Banner, Tabs } from '../../components/ui'
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
import FlowChart, { FlowLegend } from './charts/FlowChart'
import FlowViewControl from './charts/FlowViewControl'
import { flowHasActivity, flowNotes, flowYears } from './charts/flowView'
import FlowLedger, { flowNet } from './charts/FlowLedger'
import { flowScale } from './charts/flowScale'
import { PROVINCE_LIMIT } from './constants'
import { count, deltaTone } from './format'
import { ongoingLink, problematicLink } from './links'
import { useDashboard } from './useDashboard'

const ONGOING_TABS = [
  { key: 'contractor', label: 'Contractor' },
  { key: 'province', label: 'Province' },
  { key: 'age', label: 'How long' },
]

/** The page's three views, as a segmented control in the title row. The view
 * lives in the address (`?tab=breakdowns`, `?tab=contractors-provinces`), so a
 * link or a bookmark opens it and Back returns to the one before; Overview is
 * the default and carries no param. The KPI band belongs to Overview: each
 * view is sized to fit one screen on the office display, and the band above
 * all three would push the other two past it. */
const OVERVIEW = 'overview'
const BREAKDOWNS = 'breakdowns'
const RANKINGS = 'contractors-provinces'
const VIEW_TABS = [
  { key: OVERVIEW, label: 'Overview' },
  { key: BREAKDOWNS, label: 'Breakdowns' },
  { key: RANKINGS, label: 'Contractors & provinces' },
]
const VIEW_KEYS = new Set(VIEW_TABS.map((t) => t.key))

/** Every breakdown bar is the accent, on the track: the bars are a share, and
 * the card's title names the state. Folded and uncategorized rows take the
 * darker neutral (see RankedBars). */
const BAR_COLOR = 'var(--accent)'

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
  // Which Shamsi year the trend shows; null is the latest year. Held here,
  // not in the chart, because the card header shows both the control that
  // switches it and the note that describes the view.
  const [flowScope, setFlowScope] = useState(null)
  const [provinceSearch, setProvinceSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const toast = useToast()
  const provinceRef = useRef(null)

  const data = overview.data
  const provinces = useMemo(() => data?.provinces ?? [], [data])
  const provinceName = provinces.find((p) => p.id === provinceId)?.name

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

  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  const view = VIEW_KEYS.has(requested) ? requested : OVERVIEW
  const setView = useCallback(
    (next) => {
      const params = new URLSearchParams(searchParams)
      if (next === OVERVIEW) params.delete('tab')
      else params.set('tab', next)
      // Pushed, not replaced: Back returns to the view the reader came from.
      setSearchParams(params)
    },
    [searchParams, setSearchParams],
  )

  // "View province details" in the gap alert opens the tables view and then
  // scrolls to the province table, which only exists once that view renders.
  const [provincesPending, setProvincesPending] = useState(false)
  const scrollToProvinces = useCallback(() => {
    setView(RANKINGS)
    setProvincesPending(true)
  }, [setView])
  useEffect(() => {
    if (!provincesPending || view !== RANKINGS || !provinceRef.current) return
    provinceRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    setProvincesPending(false)
  }, [provincesPending, view, data])

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
        color: BAR_COLOR,
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
        color: BAR_COLOR,
        hrefFor: (p) => {
          const id = provinces.find((x) => x.name === p.name)?.id
          return id ? ongoingLink({ provinceId: id }) : null
        },
      },
      age: {
        points: b.by_age,
        unit: 'Held for',
        hrefFor: (p) => (p.key ? ongoingLink({ ...scope, ageBand: p.key }) : null),
        color: BAR_COLOR,
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
        // "Uncategorized" is the absence of a category, drawn like a folded
        // row: italic name, neutral bar. It keeps its link.
        points: b.by_category.map((p) => (p.key === 'Uncategorized' ? { ...p, quiet: true } : p)),
        unit: 'Category',
        color: BAR_COLOR,
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
        color: BAR_COLOR,
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
        color: BAR_COLOR,
        hrefFor: (p) => {
          const id = provinces.find((x) => x.name === p.name)?.id
          return id ? problematicLink({ provinceId: id }) : null
        },
      },
    }
  }, [data, provinces, provinceId])

  return (
    <DrillProvider>
      <div className="dt-page">
        {/* One 48px row: the breadcrumb and title, the three views as a
            segmented control beside it, then the scope, freshness and the
            two actions pushed right. The header is shared by all three tabs,
            so switching views never moves it. No subtitle: the scope button
            names the province the page is narrowed to. */}
        <header className="dt-head">
          <div className="dt-head-title">
            <span className="dt-head-crumb">Drive Test</span>
            <span className="dt-head-sep" aria-hidden="true">
              /
            </span>
            <h1>Dashboard</h1>
          </div>
          <Tabs
            className="dt-view-tabs"
            label="Dashboard view"
            tabs={VIEW_TABS}
            value={view}
            onChange={setView}
          />
          <Toolbar
            provinceId={provinceId}
            provinceName={provinceName}
            onClearProvince={() => setProvince(null)}
            onPickProvince={scrollToProvinces}
            onRefresh={refresh}
            refreshing={refreshing}
            generatedAt={data?.generated_at}
            onExport={exportWorkbook}
            exporting={exporting}
          />
        </header>

        <div className="dt-bench">
          {overview.error ? (
            <Banner
              tone="error"
              className="dt-page-error"
              title="Could not load the Drive Test figures."
            >
              <p>Everything on this page comes from that request, so there is nothing to show.</p>
              <button type="button" className="btn" onClick={refresh}>
                Try again
              </button>
            </Banner>
          ) : (
            data && (
              // On every tab: a growing gap is news wherever the reader is.
              <AlertStrip
                kpis={data.kpis}
                provinces={data.province_breakdown}
                onScrollToProvinces={scrollToProvinces}
              />
            )
          )}

          {view === OVERVIEW ? (
            <div className="dt-view" role="tabpanel" aria-label="Overview">
              {overview.loading && !data ? (
                <KpiSkeleton />
              ) : (
                data && <KpiBand kpis={data.kpis} provinceId={provinceId} />
              )}

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
                  icon={TrendingUp}
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
                  actions={flowHasActivity(flow.data) && <FlowLegend />}
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
                      // Keyed on the year shown, so switching years redraws the
                      // chart rather than morphing one year's columns into the next.
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
                      icon={ArrowLeftRight}
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
            </div>
          ) : view === BREAKDOWNS ? (
            <div className="dt-view" role="tabpanel" aria-label="Breakdowns">
              <div className="dt-pair">
                {has('ongoing_breakdown') && (
                  <Section
                    title="Ongoing breakdown"
                    icon={Hourglass}
                    inline
                    className="dt-breakdown-section"
                    state={overview}
                    onRetry={refresh}
                    actions={
                      data && <SectionTotal value={data.ongoing_breakdown.total} label="ongoing" />
                    }
                  >
                    {(d) => (
                      <>
                        <BreakdownTabs
                          idBase="dt-ongoing"
                          tabs={ONGOING_TABS}
                          tab={ongoingTab}
                          onTab={setOngoingTab}
                        />
                        <BreakdownCard
                          idBase="dt-ongoing"
                          tab={ongoingTab}
                          views={ongoingViews}
                          total={d.ongoing_breakdown.total}
                        />
                      </>
                    )}
                  </Section>
                )}

                {has('problematic_breakdown') && (
                  <Section
                    title="Problematic breakdown"
                    icon={OctagonAlert}
                    inline
                    className="dt-breakdown-section"
                    state={overview}
                    onRetry={refresh}
                    actions={
                      data && (
                        <SectionTotal value={data.problematic_breakdown.total} label="problematic" />
                      )
                    }
                  >
                    {(d) => (
                      <>
                        <BreakdownTabs
                          idBase="dt-problematic"
                          tabs={PROBLEMATIC_TABS}
                          tab={problematicTab}
                          onTab={setProblematicTab}
                        />
                        <BreakdownCard
                          idBase="dt-problematic"
                          tab={problematicTab}
                          views={problematicViews}
                          total={d.problematic_breakdown.total}
                        />
                      </>
                    )}
                  </Section>
                )}
              </div>
            </div>
          ) : (
            <div className="dt-view" role="tabpanel" aria-label="Contractors & provinces">
              {/* The two tables, stacked: side by side they do not fit this
                  page's width without hiding columns -- measured, see app.css. */}
              <div className="dt-tables">
                {has('contractor_scorecard') && (
                  <Section
                    title="Contractor scorecard"
                    icon={Building2}
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
                      title="Drive Test progress by province"
                      icon={MapPinned}
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
          )}
        </div>
      </div>
    </DrillProvider>
  )
}

/** The month's net change in the backlog: ink, with its sign. Whether that
 * was good news is in `data-tone` and a visually hidden word, not a colour. */
function NetChange({ value }) {
  if (value == null) return null
  const tone = deltaTone(value, 'down') ?? 'flat'
  return (
    <span className="dt-section-total">
      <b className="tnum" data-tone={tone}>
        {value > 0 ? '+' : ''}
        {count(value)}
      </b>
      <span className="dt-sr-only">{NET_WORD[tone]}</span>
      <span>net</span>
    </span>
  )
}

const NET_WORD = { good: 'better', bad: 'worse', flat: 'no change' }

/** A breakdown's total, in the card header: ink, not the state's colour --
 * the card's title names the state. */
function SectionTotal({ value, label }) {
  return (
    <span className="dt-section-total">
      <b className="tnum">{count(value)}</b>
      <span>{label}</span>
    </span>
  )
}

function KpiSkeleton() {
  return (
    <div className="dt-kpi-band dt-kpi-skeleton" aria-hidden="true">
      <span className="dt-skeleton-row" style={{ height: 110 }} />
      <span className="dt-skeleton-row" style={{ height: 110, animationDelay: '0.08s' }} />
      <span className="dt-skeleton-row" style={{ height: 110, animationDelay: '0.16s' }} />
      <span className="dt-skeleton-row" style={{ height: 110, animationDelay: '0.24s' }} />
    </div>
  )
}
