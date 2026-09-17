import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import {
  BadgeCheck,
  LayoutDashboard,
  MapPin,
  ShieldCheck,
  Landmark,
  CheckCircle2,
  Clock,
  Hourglass,
  Layers,
  XCircle,
  GitCompareArrows,
} from 'lucide-react'
import api from '../../api/client'
import { Loading, PageHead, fadeUp } from '../../components/ui'

// ICT and CRA get a stable accent colour each, reused across every card and
// table so the eye can track one authority at a glance when they sit side by
// side. The verdict colours are the platform's and mean the same thing here as
// everywhere else: green decided yes, red decided no, amber nobody has said.
const ICT = 'var(--signal, #4f8cff)'
const CRA = 'var(--violet, #a06bff)'
const APPROVED = 'var(--green)'
const REJECTED = 'var(--red)'
const PENDING = 'var(--amber)'

const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'provinces', label: 'Province Status', icon: MapPin },
]

// When a wait stops being normal and starts being a problem. These colour the
// aging column and nothing else — no number on this page is computed from
// them, so moving a threshold changes what reads as urgent, never a count.
const AGE_SLIPPING = 30
const AGE_BAD = 60

/**
 * Reports → Acceptance Dashboard: where ICT/CRA status is *read*.
 *
 * This is the reporting half of what used to be one Acceptance page with tabs.
 * The other half — actually filing and validating letters — is My Work. They
 * were split because they are different jobs done by different people at
 * different times, and a screen that tried to be both made the reader wade
 * through a work queue and the worker wade through KPIs.
 *
 * Every authority reads three ways, not two. "Approved and remained" collapsed
 * a refusal the programme has to answer and a wait it has to chase into one
 * number, and they are different work — so Approved / Rejected / Pending is the
 * shape of every card and every bar on this page.
 *
 * Counts are of every (site, village) row in the DT-Done هدف universe,
 * duplicates kept — see acceptance_analytics.py. Nothing here writes.
 */
export default function AcceptanceDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [tab, setTab] = useState('overview')

  useEffect(() => {
    api
      .get('/acceptance/overview')
      .then((r) => setData(r.data))
      .catch(() => setError(true))
  }, [])

  if (error) return <div className="card"><div className="empty">Could not load acceptance data.</div></div>
  if (!data) return <Loading label="Loading acceptance data" />

  return (
    <>
      <PageHead
        eyebrow="Reports"
        title="Acceptance Dashboard"
        subtitle="ICT and CRA approval across your provinces, village by village."
      />

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
          {tab === 'overview' && <OverviewTab data={data} />}
          {tab === 'provinces' && <ProvinceTab provinces={data.provinces} />}
        </motion.div>
      </AnimatePresence>
    </>
  )
}

/* ---------------------------------------------------------------- Overview */

function OverviewTab({ data }) {
  const { kpis, analysis } = data
  const total = kpis.total_dt_done_villages
  const accepted = analysis.villages_both_approved ?? 0

  return (
    <>
      <HeadlineCard total={total} accepted={accepted} />

      <div className="acc-section"><GitCompareArrows size={13} /> By authority</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <AuthorityCard
          title="ICT"
          subtitle="Province office"
          icon={ShieldCheck}
          color={ICT}
          total={total}
          approved={kpis.total_ict_approval}
          rejected={kpis.total_ict_rejected ?? 0}
          pending={kpis.total_ict_pending ?? 0}
        />
        <AuthorityCard
          title="CRA"
          subtitle="Region office"
          icon={Landmark}
          color={CRA}
          total={total}
          approved={kpis.total_cra_approval}
          rejected={kpis.total_cra_rejected ?? 0}
          pending={kpis.total_cra_pending ?? 0}
        />
      </div>

      <div className="acc-section"><Layers size={13} /> Work items fully approved (all villages of a site)</div>
      <div className="card">
        <div className="stat-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)', borderTop: 'none' }}>
          <Cell icon={ShieldCheck} label="ICT" value={analysis.sites_ict_full} color={ICT} />
          <Cell icon={Landmark} label="CRA" value={analysis.sites_cra_full} color={CRA} />
          <Cell icon={CheckCircle2} label="ICT & CRA" value={analysis.sites_ict_and_cra_full} color={APPROVED} />
        </div>
      </div>

      <div className="acc-section"><Clock size={13} /> Approved by one authority, not the other</div>
      <div className="card">
        <div className="stat-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', borderTop: 'none' }}>
          <Cell label="Sites ICT ✓ / CRA ✗" value={analysis.sites_ict_not_cra} color={ICT} />
          <Cell label="Sites CRA ✓ / ICT ✗" value={analysis.sites_cra_not_ict} color={CRA} />
          <Cell label="Villages ICT ✓ / CRA ✗" value={analysis.villages_ict_not_cra} color={ICT} />
          <Cell label="Villages CRA ✓ / ICT ✗" value={analysis.villages_cra_not_ict} color={CRA} />
        </div>
      </div>
    </>
  )
}

/**
 * The one card that answers "where are we" before anything is compared.
 *
 * Fully accepted is the number a programme manager is asked for and the only
 * one on this page that means finished: a village both authorities have
 * approved needs nothing further from anyone.
 */
function HeadlineCard({ total, accepted }) {
  const open = Math.max(total - accepted, 0)
  const pct = total ? Math.round((accepted / total) * 100) : 0
  return (
    <motion.div className="card mt-8" variants={fadeUp} initial="hidden" animate="show">
      <div style={{ padding: '20px 20px 18px' }}>
        <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-muted)', fontSize: 12 }}>
          <BadgeCheck size={15} strokeWidth={2} /> Fully accepted villages
        </div>
        <div className="row" style={{ alignItems: 'baseline', gap: 12, marginTop: 8 }}>
          <span className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {accepted}
          </span>
          <span className="dim" style={{ fontSize: 13 }}>
            approved by ICT <em style={{ fontStyle: 'normal', color: 'var(--text-muted)' }}>and</em> CRA · {pct}% of {total}
          </span>
        </div>
        <div className="split-bar" style={{ marginTop: 14 }}>
          <span style={{ flex: accepted, background: APPROVED }} />
          <span style={{ flex: open, background: 'var(--surface-3)' }} />
        </div>
      </div>
      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Cell label="DT-Done هدف villages" value={total} sub="The acceptance universe — every (site, village) row" />
        <Cell icon={CheckCircle2} label="Fully accepted" value={accepted} color={APPROVED} sub={`${pct}% of the universe`} />
        <Cell icon={Hourglass} label="Still open" value={open} color={PENDING} sub="Outstanding with at least one authority" />
      </div>
    </motion.div>
  )
}

/**
 * One authority, read three ways.
 *
 * The bar carries the shape of the problem before any number is read: a long
 * amber tail is a province office that has not replied, a red one is a set of
 * refusals somebody has to answer. They used to be one "remained" figure, and
 * that made them look like the same job.
 */
function AuthorityCard({ title, subtitle, icon: Icon, color, total, approved, rejected, pending }) {
  const pct = total ? Math.round((approved / total) * 100) : 0
  return (
    <motion.div className="card" variants={fadeUp} initial="hidden" animate="show" style={{ borderTop: `3px solid ${color}` }}>
      <div style={{ padding: '18px 20px 16px' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 7, color, fontSize: 13, fontWeight: 600 }}>
            <Icon size={15} strokeWidth={2} /> {title}
          </div>
          <span className="dim" style={{ fontSize: 11.5 }}>{subtitle}</span>
        </div>

        <div className="row" style={{ alignItems: 'baseline', gap: 10, marginTop: 10 }}>
          <span className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {approved}
          </span>
          <span className="dim" style={{ fontSize: 12.5 }}>approved · {pct}% of {total}</span>
        </div>

        <div className="split-bar" style={{ marginTop: 12 }}>
          <span style={{ flex: approved, background: color }} />
          <span style={{ flex: rejected, background: REJECTED }} />
          <span style={{ flex: pending, background: PENDING }} />
        </div>
      </div>

      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Cell icon={CheckCircle2} label="Approved" value={approved} color={color} />
        <Cell icon={XCircle} label="Rejected" value={rejected} color={REJECTED} />
        <Cell icon={Hourglass} label="Pending" value={pending} color={PENDING} />
      </div>
    </motion.div>
  )
}

/** One figure in a divided row: a label, the number, and an optional line. */
function Cell({ icon: Icon, label, value, color, sub }) {
  return (
    <div className="cell">
      <div className="k">{Icon && <Icon size={12} style={{ color: color || 'var(--text-dim)' }} />} {label}</div>
      <div className="v" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  )
}

/* --------------------------------------------------------- Province Status */

function ProvinceTab({ provinces }) {
  if (!provinces || provinces.length === 0) {
    return <div className="card mt-8"><div className="empty" style={{ padding: 24 }}>No provinces with DT-done هدف villages yet.</div></div>
  }
  return (
    <>
      <div className="dim mt-8" style={{ fontSize: 12.5, marginBottom: 10 }}>
        Worst first — provinces are ordered by how much is still outstanding across both
        authorities, not by how many villages they hold. Aging is the longest a village
        there has been sitting with that authority.
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))' }}>
        <ProvinceTable title="ICT status per province" icon={ShieldCheck} color={ICT} rows={provinces} authority="ict" />
        <ProvinceTable title="CRA status per province" icon={Landmark} color={CRA} rows={provinces} authority="cra" />
      </div>
    </>
  )
}

function ProvinceTable({ title, icon: Icon, color, rows, authority }) {
  return (
    <motion.div className="card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div style={{ padding: '18px 20px 14px' }}>
        <h3 style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 7, color }}>
          <Icon size={15} /> {title}
        </h3>
      </div>
      <div style={{ maxHeight: 460, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Province</th>
              <th style={{ textAlign: 'right' }}>Approved</th>
              <th style={{ textAlign: 'right' }}>Remained</th>
              <th style={{ textAlign: 'right' }}>Aging</th>
              <th style={{ textAlign: 'right' }}>% Approved</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const approved = r[`${authority}_approved`]
              const remained = r[`${authority}_remained`]
              const apct = r[`${authority}_approved_pct`]
              return (
                <tr key={r.name + i}>
                  <td className="text-data" style={{ fontWeight: 500 }}>{r.name}</td>
                  <td className="tnum" style={{ textAlign: 'right', color, fontWeight: 500 }}>{approved}</td>
                  <td className="tnum" style={{ textAlign: 'right', color: remained ? 'var(--amber)' : 'var(--text-dim)' }}>{remained}</td>
                  <td style={{ textAlign: 'right' }}><Age days={r[`${authority}_oldest_days`]} /></td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                      <div style={{ width: 54, height: 6, background: 'var(--surface-3, var(--surface-2))', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${apct}%`, height: '100%', background: color, borderRadius: 4 }} />
                      </div>
                      <span className="tnum dim" style={{ fontSize: 12, minWidth: 40 }}>{apct}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}

/**
 * The oldest wait in a province, for one authority.
 *
 * A dash is not zero: it means nothing is pending with that authority there,
 * which is the good case and must not read as "waiting no time at all".
 */
function Age({ days }) {
  if (days == null) return <span className="age is-none" title="Nothing pending with this authority">—</span>
  const tone = days >= AGE_BAD ? 'is-bad' : days >= AGE_SLIPPING ? 'is-slipping' : 'is-ok'
  return (
    <span className={`age ${tone}`} title={`Oldest village has been waiting ${days} days`}>
      {days}d
    </span>
  )
}
