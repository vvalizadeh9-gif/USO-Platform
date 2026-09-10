import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Radio,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Loader2,
  TrendingUp,
  TrendingDown,
  CornerDownRight,
  CalendarCheck,
  Target,
  ClipboardList,
  Gauge,
  BarChart3,
  Table2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import api from '../api/client'
import { Loading, PageHead, fadeUp, stagger } from '../components/ui'

export default function DriveTestProject() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [plan, setPlan] = useState(null)

  useEffect(() => {
    api
      .get('/drive-test/overview')
      .then((r) => setData(r.data))
      .catch(() => setError(true))
    // Fetched and failed separately from the overview on purpose. This is one
    // section of a page with six of them, and a dashboard that goes blank
    // because its newest block could not load is worse than a dashboard
    // missing its newest block.
    api
      .get('/drive-test/plan-delivery')
      .then((r) => setPlan(r.data))
      .catch(() => setPlan(null))
  }, [])

  if (error) return <div className="card"><div className="empty">Could not load Drive Test data.</div></div>
  if (!data) return <Loading label="Loading Drive Test project" />

  const { kpis } = data

  return (
    <>
      <PageHead
        eyebrow="Drive Test Project"
        title="Drive Test Overview"
        subtitle={`Live on-air and drive-test status across your provinces · ${data.current_month_label}`}
      />

      {/* Primary KPIs: On-air + Done + Current-month progress sit at top level.
          Remaining is a group header with Ongoing/Problematic nested beneath it
          as its breakdown — visually connected so it's clear they sum up to
          Remaining, not separate independent totals. */}
      <motion.div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }} variants={stagger} initial="hidden" animate="show">
        <PrimaryKpiCard
          icon={Radio}
          label="Total On-air"
          kpi={kpis.total_onair}
          color="var(--signal-glow)"
        />
        <PrimaryKpiCard
          icon={CheckCircle2}
          label="Drive Test Done"
          kpi={kpis.total_dt_done}
          color="var(--green-dim)"
          showPct
        />
        <PrimaryKpiCard
          icon={CalendarCheck}
          label={`DT Done This Month (${data.current_month_label.split(' ')[0]})`}
          kpi={kpis.current_month_dt_done}
          color="var(--violet-dim, var(--signal-glow))"
        />
      </motion.div>

      {/* Remaining group: parent card + two nested sub-cards */}
      <motion.div
        className="card mt-16"
        variants={fadeUp}
        initial="hidden"
        animate="show"
        style={{ borderLeft: '3px solid var(--amber)' }}
      >
        <div className="card-pad" style={{ paddingBottom: 12 }}>
          <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Clock size={15} strokeWidth={2} />
            Remaining
          </div>
          <div className="row" style={{ alignItems: 'baseline', gap: 12, marginTop: 8 }}>
            <span className="value tnum" style={{ fontSize: 34 }}>{kpis.total_remaining.value}</span>
            <DeltaChip delta={kpis.total_remaining.delta} />
            {kpis.total_remaining.percent_of_onair != null && (
              <span className="dim" style={{ fontSize: 12 }}>{kpis.total_remaining.percent_of_onair}% of on-air</span>
            )}
          </div>
        </div>

        <div
          className="grid"
          style={{
            gridTemplateColumns: '1fr 1fr',
            padding: '4px 20px 20px',
            gap: 12,
          }}
        >
          <SubKpiCard icon={Loader2} label="Ongoing" kpi={kpis.total_ongoing} color="var(--signal-strong)" />
          <SubKpiCard icon={AlertTriangle} label="Problematic" kpi={kpis.total_problematic} color="var(--red)" />
        </div>
      </motion.div>

      <PlanAndDelivery data={plan} />

      {/* The three breakdowns. Each splits a total the cards above already
          show — they add depth to those figures, they do not restate them,
          and every one of them sums back to the card it came from. */}
      <OngoingBreakdownCard data={data.ongoing_breakdown} />
      <ProblematicBreakdownCard data={data.problematic_breakdown} />
      <ProvinceBreakdownCard rows={data.province_breakdown} />

      {/* Row 1: Ongoing by contractor + Problematic by category */}
      <div className="grid mt-24" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <ChartCard title="Ongoing sites per contractor" delay={0.05}>
          <BarChartBlock data={data.ongoing_by_contractor} color="var(--signal)" />
        </ChartCard>
        <ChartCard title="Problematic per category" delay={0.1}>
          <BarChartBlock data={data.problematic_by_category} color="var(--red)" />
        </ChartCard>
      </div>

      {/* Row 2: Yearly + Monthly (Shamsi) */}
      <div className="grid mt-16" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <ChartCard title="Drive tests done per year (Shamsi)" delay={0.15}>
          <BarChartBlock data={data.dt_done_yearly} color="var(--violet)" />
        </ChartCard>
        <ChartCard title={`Drive tests done per month (Shamsi ${data.current_month_label.split(' ').pop()})`} delay={0.2}>
          <MonthlyLineBlock data={data.dt_done_monthly} />
        </ChartCard>
      </div>

      {/* Row 3: DT done per contractor (all time) + province table */}
      <div className="grid mt-16" style={{ gridTemplateColumns: '1fr 1.3fr' }}>
        <ChartCard title="Drive tests done per contractor (all time)" delay={0.25}>
          <BarChartBlock data={data.dt_done_by_contractor} color="var(--green)" />
        </ChartCard>
        <ChartCard title="Drive test progress per province" delay={0.3} noPad>
          <ProvinceProgressTable data={data.progress_by_province} />
        </ChartCard>
      </div>
    </>
  )
}

// Plan and delivery: what was committed for the month against what was
// delivered. Additive to everything above it — nothing here reads or changes
// a figure the rest of the dashboard already shows.
//
// A contractor signed in here receives one row (their own) and an unnamed
// programme average; that is enforced by the endpoint, not by this component,
// which simply renders whatever rows it was given.
function PlanAndDelivery({ data }) {
  if (!data) return null

  const { achievement_percent: achievement, uncommitted_contractors: uncommitted } = data

  return (
    <motion.div
      className="card mt-24"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04, duration: 0.4 }}
    >
      <div style={{ padding: '20px 20px 0' }}>
        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Plan and delivery</h3>
        <div className="dim" style={{ fontSize: 12.5, marginBottom: 16 }}>{data.month_label}</div>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)', padding: '0 20px', gap: 12 }}
      >
        <PlanFigure
          icon={Target}
          label="PIP"
          value={data.pip}
          color="var(--violet, var(--signal-glow))"
          note={
            uncommitted > 0
              ? `${uncommitted} not committed`
              : `${data.committed_contractors} committed`
          }
        />
        <PlanFigure
          icon={ClipboardList}
          label="Assigned"
          value={data.assigned}
          color="var(--signal)"
        />
        <PlanFigure
          icon={CheckCircle2}
          label="Actual"
          value={data.actual}
          color="var(--green-dim, var(--green))"
        />
        <PlanFigure
          icon={Gauge}
          label="Achievement"
          value={achievement == null ? '—' : `${achievement}%`}
          color={bandColor(achievement)}
          // Null, not zero: there is no plan to have achieved a share of, and
          // "0%" would report a failure that has not happened.
          note={achievement == null ? 'no approved plan' : null}
        />
      </div>

      <div style={{ padding: '20px' }}>
        <div className="label" style={{ marginBottom: 12 }}>Contractor achievement</div>
        <ContractorAchievement
          rows={data.rows}
          programme={data.programme_achievement_percent}
        />
      </div>
    </motion.div>
  )
}

function PlanFigure({ icon: Icon, label, value, color, note }) {
  return (
    <div
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--border-soft)',
        borderRadius: 'var(--radius-sm)',
        padding: '13px 16px',
      }}
    >
      <div className="row" style={{ gap: 6, color: 'var(--text-dim)' }}>
        <Icon size={14} strokeWidth={2} style={{ color }} />
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div className="row" style={{ alignItems: 'baseline', gap: 8, marginTop: 6 }}>
        <span className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>{value}</span>
      </div>
      {note && <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{note}</div>}
    </div>
  )
}

// At or above target, close to it, or short of it. Three bands rather than a
// gradient, because the question the row answers is which of the three a
// contractor is in.
function bandColor(percent) {
  if (percent == null) return 'var(--text-dim)'
  if (percent >= 100) return 'var(--green)'
  if (percent >= 80) return 'var(--amber)'
  return 'var(--red)'
}

function ContractorAchievement({ rows, programme }) {
  if (!rows || rows.length === 0) {
    return <div className="empty">No contractor plans for this month.</div>
  }

  // The track runs past 100% so the target marker sits inside it rather than
  // on the end cap — otherwise everyone at or above target renders as a full
  // bar and the marker is invisible exactly when it matters.
  const highest = Math.max(
    100,
    ...rows.map((r) => r.achievement_percent || 0),
    programme || 0,
  )
  const scaleMax = Math.ceil((highest * 1.15) / 10) * 10

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((row) => (
        <AchievementRow
          key={row.contractor_id}
          label={row.name}
          percent={row.achievement_percent}
          detail={`${row.actual} of ${row.pip || '—'}`}
          scaleMax={scaleMax}
        />
      ))}
      {programme != null && (
        <AchievementRow
          label="Programme average"
          percent={programme}
          detail="all contractors"
          scaleMax={scaleMax}
          anonymous
        />
      )}
    </div>
  )
}

function AchievementRow({ label, percent, detail, scaleMax, anonymous }) {
  const width = percent == null ? 0 : Math.min(100, (percent / scaleMax) * 100)
  const marker = (100 / scaleMax) * 100
  const color = anonymous ? 'var(--text-dim)' : bandColor(percent)

  return (
    <div className="row" style={{ gap: 12, alignItems: 'center' }}>
      <div
        className="text-data"
        style={{
          width: 150,
          fontSize: 12.5,
          fontWeight: anonymous ? 400 : 500,
          fontStyle: anonymous ? 'italic' : 'normal',
          color: anonymous ? 'var(--text-muted)' : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={label}
      >
        {label}
      </div>
      <div
        style={{
          position: 'relative',
          flex: 1,
          height: 10,
          background: 'var(--surface-3)',
          borderRadius: 5,
        }}
      >
        <div
          data-testid="achievement-bar"
          style={{
            width: `${width}%`,
            height: '100%',
            background: color,
            borderRadius: 5,
            opacity: anonymous ? 0.55 : 1,
          }}
        />
        {/* The target: 100% of this contractor's own PIP. */}
        <div
          data-testid="target-marker"
          title="100% of plan"
          style={{
            position: 'absolute',
            top: -3,
            left: `${marker}%`,
            width: 2,
            height: 16,
            background: 'var(--text-muted)',
            borderRadius: 1,
          }}
        />
      </div>
      <span className="tnum dim" style={{ fontSize: 12.5, minWidth: 52, textAlign: 'right' }}>
        {percent == null ? 'no plan' : `${percent}%`}
      </span>
      <span className="tnum dim" style={{ fontSize: 11.5, minWidth: 68, textAlign: 'right' }}>
        {detail}
      </span>
    </div>
  )
}

function PrimaryKpiCard({ icon: Icon, label, kpi, color, showPct }) {
  return (
    <motion.div className="stat" variants={fadeUp} style={{ '--accent-glow': color }} whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
      <div className="label">
        <Icon size={15} strokeWidth={2} />
        {label}
      </div>
      <div className="value tnum">{kpi.value}</div>
      <div className="row" style={{ gap: 10, marginTop: 4 }}>
        <DeltaChip delta={kpi.delta} />
        {showPct && kpi.percent_of_onair != null && (
          <span className="dim" style={{ fontSize: 12 }}>{kpi.percent_of_onair}% of on-air</span>
        )}
      </div>
    </motion.div>
  )
}

function SubKpiCard({ icon: Icon, label, kpi, color }) {
  return (
    <div
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--border-soft)',
        borderRadius: 'var(--radius-sm)',
        padding: '13px 16px',
      }}
    >
      <div className="row" style={{ gap: 6, color: 'var(--text-dim)' }}>
        <CornerDownRight size={13} />
        <Icon size={14} strokeWidth={2} style={{ color }} />
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div className="row" style={{ alignItems: 'baseline', gap: 8, marginTop: 6 }}>
        <span className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>{kpi.value}</span>
        <DeltaChip delta={kpi.delta} small />
        {kpi.percent_of_onair != null && (
          <span className="dim" style={{ fontSize: 11.5 }}>{kpi.percent_of_onair}%</span>
        )}
      </div>
    </div>
  )
}

function DeltaChip({ delta, small }) {
  const fontSize = small ? 11.5 : 12.5
  if (delta == null) return <span className="dim" style={{ fontSize }}>— vs last month</span>
  const up = delta >= 0
  const Icon = up ? TrendingUp : TrendingDown
  const color = up ? 'var(--green)' : 'var(--red)'
  return (
    <span className="row" style={{ gap: 4, color, fontSize, fontWeight: 500 }}>
      <Icon size={small ? 12 : 14} />
      {up ? '+' : ''}{delta}{small ? '' : ' vs last month'}
    </span>
  )
}

function ChartCard({ title, children, delay, noPad }) {
  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
    >
      <div style={{ padding: noPad ? '20px 20px 0' : '20px 20px 0' }}>
        <h3 style={{ fontSize: 15, marginBottom: noPad ? 12 : 16 }}>{title}</h3>
      </div>
      <div style={{ padding: noPad ? '0' : '0 20px 20px' }}>{children}</div>
    </motion.div>
  )
}

const TOOLTIP_STYLE = {
  background: 'var(--surface-1)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  boxShadow: 'var(--shadow-2)',
  fontSize: 13,
  fontFamily: 'var(--font-farsi)',
}

function EmptyChart() {
  return (
    <div className="dim" style={{ height: 240, display: 'grid', placeItems: 'center', fontSize: 13 }}>
      No data yet
    </div>
  )
}

function BarChartBlock({ data, color }) {
  if (!data || data.length === 0) return <EmptyChart />
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12.5 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
        <YAxis tick={{ fill: 'var(--text-dim)', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={48} fill={color} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function MonthlyLineBlock({ data }) {
  if (!data || data.every((d) => d.value === 0)) return <EmptyChart />
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11.5 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} interval={0} angle={-30} textAnchor="end" height={50} />
        <YAxis tick={{ fill: 'var(--text-dim)', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Line type="monotone" dataKey="value" stroke="var(--signal)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--signal)' }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// Province progress as a sortable, scrollable table instead of a bar chart —
// with 31 real provinces, a bar chart becomes unreadable (tiny slivers,
// illegible rotated labels). A table scales cleanly to any count and is
// easier to scan for a specific province.
function ProvinceProgressTable({ data }) {
  if (!data || data.length === 0) {
    return <div style={{ padding: '0 20px 20px' }}><EmptyChart /></div>
  }
  return (
    <div style={{ maxHeight: 300, overflowY: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Province</th>
            <th style={{ textAlign: 'right' }}>On-air</th>
            <th style={{ textAlign: 'right' }}>Done</th>
            <th style={{ textAlign: 'right' }}>Progress</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={row.name + i}>
              <td className="text-data" style={{ fontWeight: 500 }}>{row.name}</td>
              <td className="tnum" style={{ textAlign: 'right' }}>{row.onair}</td>
              <td className="tnum" style={{ textAlign: 'right', color: 'var(--green)', fontWeight: 500 }}>{row.done}</td>
              <td style={{ textAlign: 'right' }}>
                <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                  <div style={{ width: 70, height: 6, background: 'var(--surface-3)', borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${row.done_percent}%`,
                        height: '100%',
                        background: row.done_percent >= 70 ? 'var(--green)' : row.done_percent >= 30 ? 'var(--amber)' : 'var(--red)',
                        borderRadius: 4,
                      }}
                    />
                  </div>
                  <span className="tnum dim" style={{ fontSize: 12.5, minWidth: 38 }}>{row.done_percent}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------- breakdowns
//
// Three sections that split totals the cards above already show. Everything
// here is additive: no existing card, chart or figure is read differently
// because of it, and each section reconciles to the card it came from — the
// backend guarantees the arithmetic, these components only have to not lose
// it on the way to the screen.
//
// Tabs and the chart/table toggle are local state on purpose. They are a way
// of looking at one card, not a place in the app, so they belong to the
// component and not to the URL — no routing changes, and no way to land on
// this page with a tab selected that means nothing to the person arriving.

const ONGOING_TABS = [
  // Stage first, and it is the reason the section exists: it is the only view
  // that says what is actually holding each site up.
  { key: 'stage', label: 'Stage' },
  { key: 'contractor', label: 'Contractor' },
  { key: 'province', label: 'Province' },
]

const PROBLEMATIC_TABS = [
  { key: 'category', label: 'Category' },
  { key: 'province', label: 'Province' },
]

//: How many rows a province view shows before the rest are folded into one
//: line. Six is what fits without the section becoming a second page.
const PROVINCE_LIMIT = 6

/** Top ``limit`` points, with everything below them folded into one line.
 *
 * The remainder line is not decoration — it is what keeps the view summing to
 * its total once the tail is hidden. Dropping the tail instead would make a
 * truncated list read as a complete one.
 */
function collapseProvinces(points) {
  if (!points || points.length <= PROVINCE_LIMIT + 1) return points || []
  const head = points.slice(0, PROVINCE_LIMIT)
  const tail = points.slice(PROVINCE_LIMIT)
  const rest = tail.reduce((sum, p) => sum + p.value, 0)
  return [...head, { name: `${tail.length} more provinces`, value: rest, muted: true }]
}

function OngoingBreakdownCard({ data }) {
  const [tab, setTab] = useState('stage')
  const [table, setTable] = useState(false)

  if (!data) return null

  const views = {
    stage: {
      points: data.by_stage,
      unit: 'Stage',
      // Stage arrives in workflow order and must stay in it: the row of
      // buckets is read left to right as a pipeline, and re-sorting it by
      // size would turn a sequence into a ranking of nothing.
      note: null,
    },
    contractor: {
      points: data.by_contractor,
      unit: 'Contractor',
      // Stated rather than left to be inferred from a total that does not
      // match: sites with no contractor are deliberately not a bar here, and
      // without this line the view looks short by exactly that many.
      note:
        data.without_contractor > 0
          ? `${data.without_contractor} ongoing ${
              data.without_contractor === 1 ? 'site has' : 'sites have'
            } no contractor and are not shown above.`
          : 'Every ongoing site has a contractor.',
    },
    province: {
      points: collapseProvinces(data.by_province),
      unit: 'Province',
      note: null,
    },
  }
  const view = views[tab]

  return (
    <BreakdownCard
      title="Ongoing breakdown"
      total={data.total}
      totalLabel="ongoing"
      icon={Loader2}
      accent="var(--signal-strong)"
      tabs={ONGOING_TABS}
      tab={tab}
      onTab={setTab}
      table={table}
      onTable={setTable}
      delay={0.05}
    >
      {table ? (
        <BreakdownTable points={view.points} total={data.total} unit={view.unit} />
      ) : (
        <BreakdownBars points={view.points} total={data.total} color="var(--signal)" />
      )}
      {view.note && (
        <div className="dim" style={{ fontSize: 12, marginTop: 14 }}>{view.note}</div>
      )}
    </BreakdownCard>
  )
}

function ProblematicBreakdownCard({ data }) {
  const [tab, setTab] = useState('category')
  const [table, setTable] = useState(false)

  if (!data) return null

  const points =
    tab === 'category' ? data.by_category : collapseProvinces(data.by_province)
  const unit = tab === 'category' ? 'Category' : 'Province'

  return (
    <BreakdownCard
      title="Problematic breakdown"
      total={data.total}
      totalLabel="problematic"
      icon={AlertTriangle}
      accent="var(--red)"
      tabs={PROBLEMATIC_TABS}
      tab={tab}
      onTab={setTab}
      table={table}
      onTable={setTable}
      delay={0.08}
    >
      {table ? (
        <BreakdownTable points={points} total={data.total} unit={unit} />
      ) : (
        <BreakdownBars points={points} total={data.total} color="var(--red)" />
      )}
    </BreakdownCard>
  )
}

/** Card chrome shared by the two breakdown sections: heading, total, tabs and
 *  the chart/table toggle. The sections differ only in what they put inside. */
function BreakdownCard({
  title, total, totalLabel, icon: Icon, accent, tabs, tab, onTab, table, onTable, delay, children,
}) {
  return (
    <motion.div
      className="card mt-16"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
    >
      <div className="row" style={{ padding: '20px 20px 0', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ fontSize: 15, marginBottom: 4 }}>{title}</h3>
          <div className="row" style={{ gap: 7, alignItems: 'baseline' }}>
            <Icon size={14} strokeWidth={2} style={{ color: accent, alignSelf: 'center' }} />
            <span className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>
              {total}
            </span>
            <span className="dim" style={{ fontSize: 12.5 }}>{totalLabel}</span>
          </div>
        </div>
        <div className="spacer" />
        <ViewToggle table={table} onChange={onTable} />
      </div>

      <div style={{ padding: '0 20px' }}>
        <div className="tabs" style={{ marginTop: 14, marginBottom: 18 }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`tab ${tab === t.key ? 'active' : ''}`}
              style={{ padding: '9px 14px', fontSize: 13 }}
              onClick={() => onTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 20px 20px' }}>{children}</div>
    </motion.div>
  )
}

/** Chart or table, for the card it sits in. Same data either way — the bars
 *  are for seeing the shape, the table for reading the numbers. */
function ViewToggle({ table, onChange }) {
  return (
    <div className="row" style={{ gap: 4 }}>
      <button
        className={`btn btn-sm ${table ? 'btn-ghost' : ''}`}
        aria-pressed={!table}
        onClick={() => onChange(false)}
      >
        <span className="row" style={{ gap: 5 }}><BarChart3 size={13} /> Chart</span>
      </button>
      <button
        className={`btn btn-sm ${table ? '' : 'btn-ghost'}`}
        aria-pressed={table}
        onClick={() => onChange(true)}
      >
        <span className="row" style={{ gap: 5 }}><Table2 size={13} /> Table</span>
      </button>
    </div>
  )
}

/** Horizontal bars, built from styled divs the way the achievement rows above
 *  already are.
 *
 *  Horizontal rather than the page's vertical BarChartBlock because every
 *  label in these views is a phrase — "Ready for Assignment", "Returned by
 *  Contractor", a province or company name — and vertical bars would rotate
 *  them into illegibility. Same reason the province progress table is a table.
 */
function BreakdownBars({ points, total, color }) {
  if (!points || points.length === 0) return <EmptyChart />
  const widest = Math.max(1, ...points.map((p) => p.value))

  return (
    <div style={{ display: 'grid', gap: 9 }}>
      {points.map((p, i) => (
        <div className="row" key={`${p.name}-${i}`} style={{ gap: 12, alignItems: 'center' }}>
          <div
            className="text-data"
            style={{
              width: 170,
              fontSize: 12.5,
              color: p.muted ? 'var(--text-muted)' : undefined,
              fontStyle: p.muted ? 'italic' : 'normal',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={p.name}
          >
            {p.name}
          </div>
          <div style={{ flex: 1, height: 10, background: 'var(--surface-3)', borderRadius: 5 }}>
            <div
              data-testid="breakdown-bar"
              style={{
                width: `${(p.value / widest) * 100}%`,
                height: '100%',
                background: color,
                borderRadius: 5,
                opacity: p.muted ? 0.45 : 1,
              }}
            />
          </div>
          <span className="tnum" style={{ fontSize: 12.5, minWidth: 40, textAlign: 'right', fontWeight: 500 }}>
            {p.value}
          </span>
          <span className="tnum dim" style={{ fontSize: 11.5, minWidth: 46, textAlign: 'right' }}>
            {share(p.value, total)}
          </span>
        </div>
      ))}
    </div>
  )
}

/** The same points as a table, with the total spelled out at the foot.
 *
 *  The total row is the point of the table view: it is where a reader checks
 *  that what they are looking at accounts for the whole card, rather than
 *  taking it on trust.
 */
function BreakdownTable({ points, total, unit }) {
  if (!points || points.length === 0) return <EmptyChart />
  const shown = points.reduce((sum, p) => sum + p.value, 0)

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{unit}</th>
            <th style={{ textAlign: 'right' }}>Sites</th>
            <th style={{ textAlign: 'right' }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={`${p.name}-${i}`}>
              <td className="text-data" style={{ fontStyle: p.muted ? 'italic' : 'normal' }}>{p.name}</td>
              <td className="tnum" style={{ textAlign: 'right', fontWeight: 500 }}>{p.value}</td>
              <td className="tnum dim" style={{ textAlign: 'right' }}>{share(p.value, total)}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '1px solid var(--border)' }}>
            <td style={{ fontWeight: 600 }}>Total</td>
            <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{shown}</td>
            <td className="tnum dim" style={{ textAlign: 'right' }}>{share(shown, total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function share(value, total) {
  if (!total) return '—'
  return `${Math.round((value / total) * 1000) / 10}%`
}

/** Every province's full picture, worst first.
 *
 *  Sorted by the backend on remaining descending, and left in that order here:
 *  the table answers "where is the outstanding work", and re-sorting it by
 *  name in the browser would put the answer in the middle of the list.
 *
 *  Collapsed to the top six because that is the part anyone acts on, with the
 *  rest one click away rather than gone.
 */
function ProvinceBreakdownCard({ rows }) {
  const [all, setAll] = useState(false)

  if (!rows || rows.length === 0) return null

  const visible = all ? rows : rows.slice(0, PROVINCE_LIMIT)
  const hidden = rows.length - visible.length

  return (
    <motion.div
      className="card mt-16"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.11, duration: 0.4 }}
    >
      <div style={{ padding: '20px 20px 0' }}>
        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Province breakdown</h3>
        <div className="dim" style={{ fontSize: 12.5, marginBottom: 14 }}>
          Sorted by remaining drive tests, most first
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Province</th>
              <th style={{ textAlign: 'right' }}>On-air</th>
              <th style={{ textAlign: 'right' }}>Done</th>
              <th style={{ textAlign: 'right' }}>Remaining</th>
              <th style={{ textAlign: 'right' }}>Ongoing</th>
              <th style={{ textAlign: 'right' }}>Problematic</th>
              <th style={{ textAlign: 'right' }}>Done %</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={`${row.name}-${i}`}>
                <td className="text-data" style={{ fontWeight: 500 }}>{row.name}</td>
                <td className="tnum" style={{ textAlign: 'right' }}>{row.onair}</td>
                <td className="tnum" style={{ textAlign: 'right', color: 'var(--green)', fontWeight: 500 }}>{row.done}</td>
                <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{row.remaining}</td>
                <td className="tnum" style={{ textAlign: 'right' }}>{row.ongoing}</td>
                <td className="tnum" style={{ textAlign: 'right', color: row.problematic > 0 ? 'var(--red)' : undefined }}>{row.problematic}</td>
                <td className="tnum dim" style={{ textAlign: 'right' }}>{row.done_percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > PROVINCE_LIMIT && (
        <div style={{ padding: '12px 20px 20px' }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setAll((v) => !v)}>
            <span className="row" style={{ gap: 6 }}>
              {all ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {all ? 'Show top 6' : `Show all ${rows.length} provinces`}
            </span>
          </button>
          {!all && (
            <span className="dim" style={{ fontSize: 12, marginLeft: 10 }}>
              {hidden} more not shown
            </span>
          )}
        </div>
      )}
    </motion.div>
  )
}
