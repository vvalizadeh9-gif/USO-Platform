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
} from 'lucide-react'
import api from '../api/client'
import { Loading, PageHead, fadeUp, stagger } from '../components/ui'

export default function DriveTestProject() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    api
      .get('/drive-test/overview')
      .then((r) => setData(r.data))
      .catch(() => setError(true))
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
