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
  Layers,
  GitCompareArrows,
} from 'lucide-react'
import api from '../api/client'
import { Loading, PageHead, fadeUp, stagger } from '../components/ui'

// ICT and CRA get a stable accent colour each, reused across every card and
// table so the eye can track one authority at a glance when they sit side by
// side.
const ICT = 'var(--signal, #4f8cff)'
const CRA = 'var(--violet, #a06bff)'

const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'provinces', label: 'Province Status', icon: MapPin },
]

// The whole Acceptance dashboard reads ICT/CRA approval seeded from the CPM
// execution block (cols AV..BQ). Counts are of every (site, village) row in
// the DT-Done هدف universe — duplicates kept — see acceptance_analytics.py.
export default function Acceptance() {
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
        eyebrow="Regulatory"
        title="Acceptance"
        subtitle="ICT & CRA approval progress across DT-done هدف villages, compared side by side."
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
  return (
    <>
      {/* Universe: the villages every other number is measured against. */}
      <motion.div className="grid mt-8" style={{ gridTemplateColumns: '1fr' }} variants={stagger} initial="hidden" animate="show">
        <PrimaryKpiCard
          icon={BadgeCheck}
          label="Total DT-Done هدف Villages"
          value={kpis.total_dt_done_villages}
          color="var(--green-dim, var(--green))"
          hint="Every (site, village) row — the acceptance universe"
        />
      </motion.div>

      {/* ICT vs CRA, side by side for direct comparison. */}
      <div className="grid mt-16" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <AuthorityCard
          title="ICT Approval"
          icon={ShieldCheck}
          color={ICT}
          approved={kpis.total_ict_approval}
          remained={kpis.total_ict_remained}
          total={kpis.total_dt_done_villages}
        />
        <AuthorityCard
          title="CRA Approval"
          icon={Landmark}
          color={CRA}
          approved={kpis.total_cra_approval}
          remained={kpis.total_cra_remained}
          total={kpis.total_dt_done_villages}
        />
      </div>

      {/* Analysis area */}
      <div className="row mt-24" style={{ gap: 8, alignItems: 'center' }}>
        <GitCompareArrows size={16} />
        <h3 style={{ fontSize: 15 }}>Analysis</h3>
      </div>

      {/* Fully-approved work items (measured per site). */}
      <div className="dim" style={{ fontSize: 12, margin: '10px 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Layers size={13} /> Work items fully approved (all villages of a site)
      </div>
      <motion.div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }} variants={stagger} initial="hidden" animate="show">
        <MiniCard label="ICT fully approved" value={analysis.sites_ict_full} color={ICT} />
        <MiniCard label="CRA fully approved" value={analysis.sites_cra_full} color={CRA} />
        <MiniCard label="ICT & CRA fully approved" value={analysis.sites_ict_and_cra_full} color="var(--green)" icon={CheckCircle2} />
      </motion.div>

      {/* Mismatches: approved by one authority, still pending the other. */}
      <div className="dim" style={{ fontSize: 12, margin: '18px 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Clock size={13} /> Approved by one authority, pending the other
      </div>
      <motion.div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }} variants={stagger} initial="hidden" animate="show">
        <MiniCard label="Sites: ICT ✓ / CRA ✗" value={analysis.sites_ict_not_cra} color={ICT} />
        <MiniCard label="Sites: CRA ✓ / ICT ✗" value={analysis.sites_cra_not_ict} color={CRA} />
        <MiniCard label="Villages: ICT ✓ / CRA ✗" value={analysis.villages_ict_not_cra} color={ICT} />
        <MiniCard label="Villages: CRA ✓ / ICT ✗" value={analysis.villages_cra_not_ict} color={CRA} />
      </motion.div>
    </>
  )
}

function PrimaryKpiCard({ icon: Icon, label, value, color, hint }) {
  return (
    <motion.div className="stat" variants={fadeUp} style={{ '--accent-glow': color }} whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
      <div className="label"><Icon size={15} strokeWidth={2} /> {label}</div>
      <div className="value tnum">{value}</div>
      {hint && <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>{hint}</div>}
    </motion.div>
  )
}

function AuthorityCard({ title, icon: Icon, color, approved, remained, total }) {
  const pct = total ? Math.round((approved / total) * 100) : 0
  return (
    <motion.div className="card" variants={fadeUp} initial="hidden" animate="show" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="card-pad">
        <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 7, color }}>
          <Icon size={15} strokeWidth={2} /> {title}
        </div>

        <div className="row" style={{ alignItems: 'baseline', gap: 12, marginTop: 10 }}>
          <span className="value tnum" style={{ fontSize: 34 }}>{approved}</span>
          <span className="dim" style={{ fontSize: 12.5 }}>approved · {pct}% of {total}</span>
        </div>

        {/* Progress bar: approved vs remained. */}
        <div style={{ height: 8, background: 'var(--surface-3, var(--surface-2))', borderRadius: 5, overflow: 'hidden', marginTop: 12 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 5 }} />
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
          <SubStat label="Approved" value={approved} color={color} />
          <SubStat label="Remained" value={remained} color="var(--amber)" />
        </div>
      </div>
    </motion.div>
  )
}

function SubStat({ label, value, color }) {
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '11px 14px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
      <div className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function MiniCard({ label, value, color, icon: Icon }) {
  return (
    <motion.div
      variants={fadeUp}
      className="card"
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      style={{ padding: '14px 16px', borderTop: `3px solid ${color}` }}
    >
      <div className="row" style={{ gap: 6, color: 'var(--text-muted)', fontSize: 12.5 }}>
        {Icon && <Icon size={13} style={{ color }} />} {label}
      </div>
      <div className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </motion.div>
  )
}

/* --------------------------------------------------------- Province Status */

function ProvinceTab({ provinces }) {
  if (!provinces || provinces.length === 0) {
    return <div className="card mt-8"><div className="empty" style={{ padding: 24 }}>No provinces with DT-done هدف villages yet.</div></div>
  }
  return (
    <div className="grid mt-8" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <ProvinceTable title="ICT status per province" icon={ShieldCheck} color={ICT} rows={provinces} authority="ict" />
      <ProvinceTable title="CRA status per province" icon={Landmark} color={CRA} rows={provinces} authority="cra" />
    </div>
  )
}

function ProvinceTable({ title, icon: Icon, color, rows, authority }) {
  return (
    <motion.div className="card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div style={{ padding: '18px 20px 0' }}>
        <h3 style={{ fontSize: 15, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 7, color }}>
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
              <th style={{ textAlign: 'right' }}>% Appr.</th>
              <th style={{ textAlign: 'right' }}>% Rem.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const approved = r[`${authority}_approved`]
              const remained = r[`${authority}_remained`]
              const apct = r[`${authority}_approved_pct`]
              const rpct = r[`${authority}_remained_pct`]
              return (
                <tr key={r.name + i}>
                  <td className="text-data" style={{ fontWeight: 500 }}>{r.name}</td>
                  <td className="tnum" style={{ textAlign: 'right', color, fontWeight: 500 }}>{approved}</td>
                  <td className="tnum" style={{ textAlign: 'right', color: 'var(--amber)' }}>{remained}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                      <div style={{ width: 54, height: 6, background: 'var(--surface-3, var(--surface-2))', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${apct}%`, height: '100%', background: color, borderRadius: 4 }} />
                      </div>
                      <span className="tnum dim" style={{ fontSize: 12, minWidth: 40 }}>{apct}%</span>
                    </div>
                  </td>
                  <td className="tnum dim" style={{ textAlign: 'right', fontSize: 12.5 }}>{rpct}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}
