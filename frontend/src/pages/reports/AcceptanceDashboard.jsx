import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock,
  FileQuestion,
  GitCompareArrows,
  Hourglass,
  Landmark,
  LayoutDashboard,
  MapPin,
  ShieldCheck,
  Target,
  XCircle,
} from 'lucide-react'
import api from '../../api/client'
import { Loading, PageHead, fadeUp } from '../../components/ui'
import { AGE_BANDS, AGE_META, ageTone, bandTotal } from './acceptanceAge'
import AcceptancePlanSection from './AcceptancePlanSection'
import { APPROVED, CRA, ICT, IDLE, PENDING, REJECTED, WASH } from './acceptanceTheme'
import { KpiHeader } from './KpiHeader'
import PlanTargetCard from './PlanTargetCard'

const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'provinces', label: 'Province Status', icon: MapPin },
]

const AUTHORITIES = [
  { key: 'ict', name: 'ICT', where: 'Province office', icon: ShieldCheck, color: ICT },
  { key: 'cra', name: 'CRA', where: 'Region office', icon: Landmark, color: CRA },
]

// Where a number goes when it is clicked: My Work, filtered to exactly the
// villages it counted. The Action Center's counters already open that screen
// this way, so a figure behaves the same wherever it is met.
const workLink = (params) =>
  `/my-work?${new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  )}`

/**
 * The list behind one figure on this page.
 *
 * Every number here counts *verdicts* — where a village stands — so the list
 * is asked for by verdict too. The queue's status vocabulary is a different
 * question ("whose move is it"), and a village ICT refused and the contractor
 * has already re-filed is Rejected as a verdict and Pending as a status. This
 * page used to link its Rejected figure at status=Rejected and so opened a
 * list missing exactly the villages someone had already acted on.
 *
 * `province` is the name, carried only so the filter chip on the other screen
 * can say which province without a second request.
 */
const listLink = ({ ict, cra, province, bucket } = {}) =>
  workLink({
    ict_verdict: ict,
    cra_verdict: cra,
    province_id: province?.province_id,
    province: province?.name,
    // Every bucket, not this role's usual landing one: a figure counted
    // across the whole universe must not open a third of it.
    bucket: bucket || 'all',
  })

/**
 * Reports → Acceptance Dashboard: where ICT/CRA status is *read*.
 *
 * This is the reporting half of what used to be one Acceptance page with tabs.
 * The other half — actually filing and validating letters — is My Work. They
 * were split because they are different jobs done by different people at
 * different times, and a screen that tried to be both made the reader wade
 * through a work queue and the worker wade through KPIs.
 *
 * Three rules hold everywhere on this page:
 *
 * Every authority reads three ways, never two. A refusal the programme has to
 * answer and a wait it has to chase are different work, and one "remained"
 * figure made them look like the same job.
 *
 * Every number opens the list it counted. A figure that cannot be examined is
 * a figure that gets argued with.
 *
 * Age is measured from the drive test, not from the last letter. The letter
 * clock is undefined for a village nobody has ever filed — which is the worst
 * case in the programme, not the best.
 *
 * Counts are of every (site, village) row in the DT-Done هدف universe,
 * duplicates kept — see acceptance_analytics.py. Nothing here writes.
 */
// Empty string, not undefined: these back <select> values directly, and a
// controlled select needs a defined value from its first render.
const EMPTY_FILTERS = { regional_manager_id: '', coordinator_id: '', contractor_id: '' }

export default function AcceptanceDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [tab, setTab] = useState('overview')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS)

  useEffect(() => {
    setError(false)
    const params = Object.fromEntries(
      Object.entries(appliedFilters).filter(([, v]) => v !== '')
    )
    api
      .get('/acceptance/overview', { params })
      .then((r) => setData(r.data))
      .catch(() => setError(true))
  }, [appliedFilters])

  if (error) return <div className="card"><div className="empty">Could not load acceptance data.</div></div>
  if (!data) return <Loading label="Loading acceptance data" />

  return (
    <>
      <PageHead
        eyebrow="Reports"
        title="Acceptance Dashboard"
        subtitle="ICT and CRA approval across your provinces, village by village."
      />

      <FilterBar value={filters} onChange={setFilters} onApply={() => setAppliedFilters(filters)} />

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <span className="row" style={{ gap: 8 }}><t.icon size={15} /> {t.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'overview' && <OverviewTab data={data} filters={appliedFilters} />}
          {tab === 'provinces' && <ProvinceTab provinces={data.provinces} />}
        </motion.div>
      </AnimatePresence>
    </>
  )
}

/**
 * Regional Manager, Coordinator and Contractor, in one compact bar.
 *
 * The first two resolve server-side to the provinces Admin assigned that
 * person in Province Assignments — neither role carries a village-level
 * attribution of its own, unlike a contractor. Picking one narrows every
 * number on both tabs to their provinces; picking a contractor narrows to
 * their work items directly. Nothing filters until Apply, so choosing all
 * three does not fire three separate loads.
 */
function FilterBar({ value, onChange, onApply }) {
  const [regionalManagers, setRegionalManagers] = useState([])
  const [coordinators, setCoordinators] = useState([])
  const [contractors, setContractors] = useState([])

  useEffect(() => {
    api.get('/reference/regional-managers').then((r) => setRegionalManagers(r.data)).catch(() => {})
    api.get('/reference/coordinators').then((r) => setCoordinators(r.data)).catch(() => {})
    api.get('/reference/contractors').then((r) => setContractors(r.data)).catch(() => {})
  }, [])

  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value })

  return (
    <div className="card card-pad row wrap" style={{ gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
      <div className="field" style={{ flex: '1 1 200px', margin: 0 }}>
        <label>Regional manager</label>
        <select className="input" value={value.regional_manager_id} onChange={set('regional_manager_id')}>
          <option value="">All regional managers</option>
          {regionalManagers.map((u) => (
            <option key={u.id} value={u.id}>{u.full_name}</option>
          ))}
        </select>
      </div>
      <div className="field" style={{ flex: '1 1 200px', margin: 0 }}>
        <label>Coordinator</label>
        <select className="input" value={value.coordinator_id} onChange={set('coordinator_id')}>
          <option value="">All coordinators</option>
          {coordinators.map((u) => (
            <option key={u.id} value={u.id}>{u.full_name}</option>
          ))}
        </select>
      </div>
      <div className="field" style={{ flex: '1 1 200px', margin: 0 }}>
        <label>Contractor</label>
        <select className="input" value={value.contractor_id} onChange={set('contractor_id')}>
          <option value="">All contractors</option>
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <button className="btn btn-primary btn-sm" onClick={onApply}>Apply</button>
    </div>
  )
}

/* ------------------------------------------------------------ shared pieces */

/** One figure in a divided row. Given `to`, it opens the list it counted. */
function Cell({ icon: Icon, label, value, color, sub, to, spoken }) {
  const navigate = useNavigate()
  const body = (
    <>
      <div className="v" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="s">{sub}</div>}
    </>
  )
  return (
    <div className="cell">
      <div className="k">{Icon && <Icon size={12} style={{ color: color || IDLE }} />} {label}</div>
      {to ? (
        <button
          className="drill"
          onClick={() => navigate(to)}
          aria-label={`${spoken || label}: ${value} villages — open the list`}
          style={{ textAlign: 'left', width: '100%' }}
        >
          {body}
        </button>
      ) : (
        body
      )}
    </div>
  )
}

/** One age in days. A dash is not zero — it means nothing is outstanding. */
function Age({ days, title }) {
  if (days == null) return <span className="age is-none" title={title || 'Nothing outstanding'}>—</span>
  return (
    <span className={`age ${ageTone(days)}`} title={`Oldest outstanding village: ${days} days since its drive test`}>
      {days}d
    </span>
  )
}

/** The age distribution behind an outstanding count, as one stacked bar. */
function AgeBar({ buckets, width = 78 }) {
  const total = bandTotal(buckets)
  if (!total) return null
  return (
    <span
      className="agebar"
      style={{ width }}
      role="img"
      aria-label={AGE_BANDS.filter((b) => buckets[b])
        .map((b) => `${AGE_META[b].label}: ${buckets[b]}`)
        .join(', ')}
    >
      {AGE_BANDS.map((band) =>
        buckets?.[band] ? (
          <span
            key={band}
            style={{ flex: buckets[band], background: AGE_META[band].color }}
            title={`${AGE_META[band].label}: ${buckets[band]}`}
          />
        ) : null
      )}
    </span>
  )
}

function AgeLegend() {
  return (
    <span className="row" style={{ gap: 13, flexWrap: 'wrap' }}>
      <span className="dim" style={{ fontSize: 11 }}>Outstanding, by age since drive test</span>
      {AGE_BANDS.map((band) => (
        <span key={band} className="row" style={{ gap: 5, fontSize: 11.5, color: 'var(--text-muted)' }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: AGE_META[band].color }} />
          {AGE_META[band].label}
        </span>
      ))}
    </span>
  )
}

/* ---------------------------------------------------------------- Overview */

function OverviewTab({ data, filters }) {
  const navigate = useNavigate()
  const { kpis, analysis, provinces } = data
  const total = kpis.total_dt_done_villages
  const accepted = analysis.villages_accepted ?? analysis.villages_both_approved ?? 0
  const remaining = total - accepted
  const acceptedPct = total ? Math.round((accepted / total) * 100) : 0
  const remainingPct = total ? Math.round((remaining / total) * 100) : 0

  // The plan is programme-wide — not scoped by this page's regional
  // manager / coordinator / contractor filters, the same as the KPI
  // contract in the task brief says of PUT /acceptance/plan — so it is
  // loaded once here rather than re-fetched on every filter change.
  const [plan, setPlan] = useState(null)
  const loadPlan = useCallback(() => {
    api.get('/acceptance/plan').then((r) => setPlan(r.data)).catch(() => setPlan(null))
  }, [])
  useEffect(loadPlan, [loadPlan])

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
        <KpiCard icon={Target} iconColor={ICT} label="Total villages" sub="Drive-test done">
          <div className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 600, marginTop: 14 }}>
            {total}
          </div>
        </KpiCard>

        <PlanTargetCard plan={plan} onSaved={loadPlan} />

        <KpiCard icon={CheckCircle2} iconColor={APPROVED} label="Fully approved" sub="Both ICT + CRA">
          <button
            className="drill tnum"
            onClick={() => navigate(workLink({ bucket: 'closed' }))}
            aria-label={`Fully approved: ${accepted} villages — open the list`}
            style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 600, marginTop: 14, color: APPROVED, display: 'block' }}
          >
            {accepted}
          </button>
          <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{acceptedPct}% of {total}</div>
          <ProportionBar pct={acceptedPct} color={APPROVED} />
        </KpiCard>

        <motion.div className="card" variants={fadeUp} initial="hidden" animate="show">
          <div style={{ padding: '18px 20px 0' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <KpiHeader icon={Clock} iconColor={REJECTED} label="Remaining" sub="Not fully approved" />
              <span className="pill pill-red pill-xs" style={{ flexShrink: 0 }}>Needs attention</span>
            </div>
            <div className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 600, marginTop: 14, color: REJECTED }}>
              {remaining}
            </div>
            <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{remainingPct}% of {total}</div>
            <ProportionBar pct={remainingPct} color={REJECTED} />
          </div>
          <div className="stat-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 14 }}>
            <Cell
              icon={XCircle} label="Needs an answer" color={REJECTED}
              value={analysis.villages_needs_attention ?? 0}
              to={workLink({ bucket: 'needs_attention' })}
            />
            <Cell
              icon={Hourglass} label="With an authority" color={PENDING}
              value={analysis.villages_in_review ?? 0}
              to={workLink({ bucket: 'awaiting_review' })}
            />
            <Cell
              icon={FileQuestion} label="Never filed" color={IDLE}
              value={analysis.villages_not_filed ?? 0}
              to={workLink({ bucket: 'ready' })}
            />
          </div>
        </motion.div>
      </div>

      <div className="acc-section"><BarChart3 size={13} /> Authority performance</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        {AUTHORITIES.map((a) => (
          <AuthorityCard
            key={a.key}
            authority={a}
            total={total}
            approved={kpis[`total_${a.key}_approval`]}
            rejected={kpis[`total_${a.key}_rejected`] ?? 0}
            pending={kpis[`total_${a.key}_pending`] ?? 0}
          />
        ))}
      </div>

      <AcceptancePlanSection total={total} analysis={analysis} kpis={kpis} filters={filters} />

      <div className="acc-section"><GitCompareArrows size={13} /> Approval gap</div>
      <ApprovalGap analysis={analysis} />

      <div className="mt-16"><TopOutstandingProvinces provinces={provinces} /></div>
    </>
  )
}

function KpiCard({ icon, iconColor, label, sub, children }) {
  return (
    <motion.div className="card card-pad" variants={fadeUp} initial="hidden" animate="show">
      <KpiHeader icon={icon} iconColor={iconColor} label={label} sub={sub} />
      {children}
    </motion.div>
  )
}

/** A thin two-tone bar: `pct` in the KPI's own colour, the rest neutral. */
function ProportionBar({ pct, color }) {
  return (
    <div className="split-bar" style={{ marginTop: 10, height: 6 }}>
      <span style={{ flex: Math.max(pct, 0.001), background: color }} />
      {pct < 100 && <span style={{ flex: 100 - pct, background: 'var(--border-soft)' }} />}
    </div>
  )
}

/**
 * One authority's approval ring, big number, segmented bar and breakdown.
 *
 * The ring shows *approved* against the remainder only — not a three-way
 * split — because the number inside it is the approved percentage, and a
 * ring that answered a different question than its own centre would read as
 * a mistake. Rejected vs. pending is what the bar underneath is for.
 */
function AuthorityCard({ authority, total, approved, rejected, pending }) {
  const navigate = useNavigate()
  const { key, name, icon: Icon, color } = authority
  const pct = total ? Math.round((approved / total) * 100) : 0
  const to = (verdict) => listLink({ [key]: verdict })
  const parts = [
    { label: 'Approved', value: approved, color, icon: CheckCircle2, verdict: 'Approved' },
    { label: 'Rejected', value: rejected, color: REJECTED, icon: XCircle, verdict: 'Rejected' },
    { label: 'Pending', value: pending, color: PENDING, icon: Hourglass, verdict: 'Pending' },
  ]
  return (
    <motion.div className="card" variants={fadeUp} initial="hidden" animate="show">
      <div style={{ padding: '20px 20px 16px' }}>
        <div className="row" style={{ gap: 7, color, fontSize: 15, fontWeight: 700, marginBottom: 14 }}>
          <Icon size={16} strokeWidth={2} /> {name}
        </div>
        <div className="row" style={{ gap: 20 }}>
          <div
            style={{
              width: 104, height: 104, borderRadius: '50%', flexShrink: 0, padding: 10,
              background: `conic-gradient(${color} 0 ${pct}%, var(--border-soft) ${pct}% 100%)`,
              display: 'grid', placeItems: 'center',
            }}
          >
            <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'var(--surface-1)', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
              <div>
                <div className="tnum" style={{ fontSize: 20, fontWeight: 700, color }}>{pct}%</div>
                <div className="dim" style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>approved</div>
              </div>
            </div>
          </div>
          <div>
            {/* The same figure as the Approved cell below — opens the same
                list, so both paths to it agree. */}
            <button
              className="drill tnum"
              onClick={() => navigate(to('Approved'))}
              aria-label={`${name} approved: ${approved} villages — open the list`}
              style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 600, display: 'block' }}
            >
              {approved}
            </button>
            <div className="dim" style={{ fontSize: 12.5 }}>approved of {total}</div>
          </div>
        </div>
        <div className="split-bar" style={{ marginTop: 18, height: 10 }}>
          {parts.map((p) => (p.value ? <span key={p.label} style={{ flex: p.value, background: p.color }} /> : null))}
        </div>
      </div>

      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {parts.map((p) => (
          <Cell
            key={p.label}
            icon={p.icon}
            label={p.label}
            value={p.value}
            color={p.color}
            spoken={`${name} ${p.label.toLowerCase()}`}
            to={to(p.verdict)}
          />
        ))}
      </div>
    </motion.div>
  )
}

/**
 * Villages approved by exactly one authority, split by which one — the
 * cross-tab a PM actually chases, once the site-level rollup (kept in
 * `analysis.sites_*` for other consumers) turned out to only ever raise "so
 * which villages, specifically", which this answers directly.
 */
function ApprovalGap({ analysis }) {
  const a = analysis.villages_ict_not_cra ?? 0
  const b = analysis.villages_cra_not_ict ?? 0
  const denom = a + b || 1
  const cards = [
    {
      key: 'ict', title: 'ICT approved — CRA not', icon: ShieldCheck, color: ICT,
      value: a, pct: Math.round((a / denom) * 100),
      note: 'Cleared by ICT, still waiting on CRA',
      to: listLink({ ict: 'Approved', cra: 'NotApproved' }),
    },
    {
      key: 'cra', title: 'CRA approved — ICT not', icon: Landmark, color: CRA,
      value: b, pct: Math.round((b / denom) * 100),
      note: 'Cleared by CRA, still waiting on ICT',
      to: listLink({ cra: 'Approved', ict: 'NotApproved' }),
    },
  ]
  const navigate = useNavigate()
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
      {cards.map((c) => (
        <motion.button
          key={c.key}
          className="card drill"
          variants={fadeUp} initial="hidden" animate="show"
          onClick={() => navigate(c.to)}
          aria-label={`${c.title}: ${c.value} villages — open the list`}
          style={{ padding: 18, textAlign: 'left', display: 'block', width: '100%' }}
        >
          <div className="row" style={{ gap: 8, marginBottom: 14 }}>
            <span
              style={{
                width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                background: WASH[c.color] || 'var(--surface-3)', color: c.color,
                display: 'grid', placeItems: 'center',
              }}
            >
              <c.icon size={13} />
            </span>
            <div className="dim" style={{ fontSize: 12.5, fontWeight: 600 }}>{c.title}</div>
          </div>
          <div className="tnum" style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.02em', color: c.color }}>{c.value}</div>
          <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>villages</div>
          <ProportionBar pct={c.pct} color={c.color} />
          <div className="dim" style={{ fontSize: 11.5, marginTop: 10 }}>{c.note}</div>
        </motion.button>
      ))}
    </div>
  )
}

/* --------------------------------------------------- Top outstanding table */

const TOP_N = 5

/** The status a province–authority pair's backlog rate earns. Two real
 * meanings the platform already has a colour for — refused-heavy (red) and
 * still-waiting (amber) — rather than a third hue invented for this table. */
function backlogStatus(rate) {
  if (rate >= 60) return { label: 'High backlog', pill: 'pill-red' }
  if (rate >= 45) return { label: 'Pending letter', pill: 'pill-amber' }
  return { label: 'Low approval rate', pill: 'pill-dim' }
}

function TopOutstandingProvinces({ provinces }) {
  const navigate = useNavigate()

  // One row per province–authority pair, worst first by what's outstanding —
  // no age, no rank toggle: this table answers "who to call this week",
  // and the Province Status tab is where the full aged breakdown lives.
  const rows = useMemo(() => {
    const pairs = (provinces || []).flatMap((p) =>
      AUTHORITIES.map((a) => ({
        province: p.name,
        province_id: p.province_id,
        authority: a,
        total: p.total,
        remained: p[`${a.key}_remained`] ?? 0,
        rate: p[`${a.key}_remained_pct`] ?? 0,
      }))
    )
    return pairs
      .filter((r) => r.remained > 0)
      .sort((a, b) => b.remained - a.remained)
      .slice(0, TOP_N)
      .map((r, i) => ({ ...r, rank: i + 1, status: backlogStatus(r.rate) }))
  }, [provinces])

  return (
    <motion.div className="card" variants={fadeUp} initial="hidden" animate="show">
      <div className="row" style={{ gap: 8, padding: '16px 20px 12px' }}>
        <AlertTriangle size={15} style={{ color: 'var(--amber)' }} />
        <div>
          <h3 style={{ fontSize: 14 }}>Top outstanding provinces</h3>
          <div className="dim" style={{ fontSize: 11.5 }}>Highest backlog and lowest approval rate</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty" style={{ padding: 18 }}>Nothing outstanding with either authority.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}>#</th>
              <th>Province</th>
              <th>Authority</th>
              <th style={{ textAlign: 'right' }}>Outstanding</th>
              <th style={{ textAlign: 'right' }}>Rate</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const to = listLink({
                [r.authority.key]: 'NotApproved',
                province: { province_id: r.province_id, name: r.province },
              })
              return (
                <tr key={r.province + r.authority.key}>
                  <td className="tnum dim">{r.rank}</td>
                  <td className="text-data" style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{r.province}</td>
                  <td>
                    <span className={`pill pill-xs ${r.authority.key === 'ict' ? 'pill-cyan' : 'pill-violet'}`}>
                      {r.authority.name}
                    </span>
                  </td>
                  <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>
                    {r.remained}<span className="dim" style={{ fontWeight: 400 }}> / {r.total}</span>
                  </td>
                  <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{r.rate}%</td>
                  <td><span className={`pill pill-xs ${r.status.pill}`}>{r.status.label}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-sm"
                      onClick={() => navigate(to)}
                      aria-label={`Open ${r.province}, outstanding with ${r.authority.name}, in My Work`}
                    >
                      Open <ArrowUpRight size={13} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </motion.div>
  )
}

/* --------------------------------------------------------- Province Status */

function ProvinceTab({ provinces }) {
  if (!provinces || provinces.length === 0) {
    return (
      <div className="card mt-8">
        <div className="empty" style={{ padding: 24 }}>No provinces with DT-done هدف villages yet.</div>
      </div>
    )
  }
  return (
    <>
      <div className="dim mt-8" style={{ fontSize: 12.5, marginBottom: 10, maxWidth: 880 }}>
        Worst first — ordered by what is still outstanding across both authorities, not by how many
        villages a province holds. Each row carries both authorities, so a province where one is far
        ahead of the other reads without comparing two tables. Under each authority's counts, the
        same villages by age: refused and unanswered separately, because they are different
        conversations. Every figure opens the villages behind it.
      </div>
      <motion.div className="card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div className="row" style={{ justifyContent: 'space-between', padding: '16px 20px 12px', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 7 }}>
            <MapPin size={15} /> Province status
          </h3>
          <AgeLegend />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="grouped">
            <thead>
              <tr>
                <th rowSpan={2} style={{ verticalAlign: 'bottom' }}>Province</th>
                <th rowSpan={2} style={{ textAlign: 'right', verticalAlign: 'bottom' }}>Villages</th>
                <th rowSpan={2} style={{ textAlign: 'right', verticalAlign: 'bottom' }}>DT done</th>
                {AUTHORITIES.map((a, i) => (
                  <th
                    key={a.key}
                    colSpan={3}
                    className={`grp ${i ? 'grp-start' : ''}`}
                    style={{ color: a.color, textAlign: 'center' }}
                  >
                    <span className="row" style={{ gap: 6, justifyContent: 'center' }}>
                      <a.icon size={13} /> {a.name}
                    </span>
                  </th>
                ))}
              </tr>
              <tr>
                {AUTHORITIES.map((a, i) => [
                  <th key={`${a.key}-a`} className={i ? 'grp-start' : ''} style={{ textAlign: 'right' }}>Approved</th>,
                  <th key={`${a.key}-r`} style={{ textAlign: 'right' }}>Rejected</th>,
                  <th key={`${a.key}-p`} style={{ textAlign: 'right' }}>Pending</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {provinces.map((p, i) => (
                <ProvinceRows key={p.name + i} province={p} />
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </>
  )
}

/**
 * One province: its counts, and underneath them the same counts aged.
 *
 * Two lines rather than four more columns. The table already scrolls
 * sideways at eight columns, and an age bar squeezed into a shared cell is
 * not a reading of anything — given the authority group's full width it is.
 *
 * The two bars are Rejected and Pending, which are disjoint and sum to what
 * is outstanding. Aging *rejected* against *remained* would have shown the
 * refused villages twice, once inside each bar, with nothing on screen
 * saying so.
 */
function ProvinceRows({ province: p }) {
  const scope = { province_id: p.province_id, name: p.name }
  return (
    <>
      <tr className="prov-counts">
        <td rowSpan={2} className="text-data" style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
          {p.name}
        </td>
        <td rowSpan={2} className="tnum dim" style={{ textAlign: 'right' }}>
          {p.total_villages ?? p.total}
        </td>
        <td rowSpan={2} className="tnum" style={{ textAlign: 'right' }}>{p.total}</td>
        {AUTHORITIES.map((a, j) => [
          <td key={`${a.key}-a`} className={`tnum ${j ? 'grp-start' : ''}`} style={{ textAlign: 'right' }}>
            <Figure
              value={p[`${a.key}_approved`]}
              color={a.color}
              weight={500}
              to={listLink({ [a.key]: 'Approved', province: scope })}
              label={`${p.name}, ${a.name} approved`}
            />
          </td>,
          <td key={`${a.key}-r`} className="tnum" style={{ textAlign: 'right' }}>
            <Figure
              value={p[`${a.key}_rejected`] ?? 0}
              color={p[`${a.key}_rejected`] ? REJECTED : IDLE}
              to={listLink({ [a.key]: 'Rejected', province: scope })}
              label={`${p.name}, ${a.name} rejected`}
            />
          </td>,
          <td key={`${a.key}-p`} className="tnum" style={{ textAlign: 'right' }}>
            <Figure
              value={p[`${a.key}_pending`] ?? 0}
              color={p[`${a.key}_pending`] ? PENDING : IDLE}
              to={listLink({ [a.key]: 'Pending', province: scope })}
              label={`${p.name}, ${a.name} pending`}
            />
          </td>,
        ])}
      </tr>
      <tr className="prov-aging">
        {AUTHORITIES.map((a, j) => (
          <td key={a.key} colSpan={3} className={j ? 'grp-start' : ''}>
            <div className="age-split">
              <AgeOf
                caption="Rejected"
                buckets={p[`${a.key}_rejected_age_buckets`]}
                days={p[`${a.key}_rejected_oldest_age_days`]}
                to={listLink({ [a.key]: 'Rejected', province: scope })}
                label={`${p.name}, ${a.name} rejected — by age`}
              />
              <AgeOf
                caption="Pending"
                buckets={p[`${a.key}_pending_age_buckets`]}
                days={p[`${a.key}_pending_oldest_age_days`]}
                to={listLink({ [a.key]: 'Pending', province: scope })}
                label={`${p.name}, ${a.name} pending — by age`}
              />
            </div>
          </td>
        ))}
      </tr>
    </>
  )
}

/** A figure in a table cell that opens the list it counted. */
function Figure({ value, color, weight, to, label }) {
  const navigate = useNavigate()
  if (!value) return <span style={{ color: IDLE }}>0</span>
  return (
    <button
      className="drill"
      style={{ color, fontWeight: weight }}
      onClick={() => navigate(to)}
      aria-label={`${label}: ${value} villages — open the list`}
    >
      {value}
    </button>
  )
}

/** One half of outstanding, aged: a caption, its bar and its oldest village. */
function AgeOf({ caption, buckets, days, to, label }) {
  const navigate = useNavigate()
  const total = bandTotal(buckets)
  if (!total) return null
  return (
    <button className="drill age-one" onClick={() => navigate(to)} aria-label={label}>
      <span className="cap">{caption}</span>
      <span className="row" style={{ gap: 6 }}>
        <AgeBar buckets={buckets} width={64} />
        <Age days={days} />
      </span>
    </button>
  )
}
