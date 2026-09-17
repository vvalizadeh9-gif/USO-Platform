import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  CheckCircle2,
  Clock,
  FileQuestion,
  GitCompareArrows,
  Hourglass,
  Landmark,
  LayoutDashboard,
  Layers,
  MapPin,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import api from '../../api/client'
import { Loading, PageHead, fadeUp } from '../../components/ui'
import { AGE_BANDS, AGE_META, ageTone, bandTotal } from './acceptanceAge'

// ICT and CRA get a stable accent colour each, reused across every card and
// table so the eye can track one authority at a glance when they sit side by
// side. The verdict colours are the platform's and mean the same thing here as
// everywhere else: green decided yes, red decided no, amber nobody has said.
const ICT = 'var(--signal, #4f8cff)'
const CRA = 'var(--violet, #a06bff)'
const APPROVED = 'var(--green)'
const REJECTED = 'var(--red)'
const PENDING = 'var(--amber)'
const IDLE = 'var(--text-dim)'

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

/* ------------------------------------------------------------ shared pieces */

/** One figure in a divided row. Given `to`, it opens the list it counted. */
function Cell({ icon: Icon, label, value, color, sub, to }) {
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
          aria-label={`${label}: ${value} villages — open the list`}
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

function OverviewTab({ data }) {
  const { kpis, analysis, provinces } = data
  const total = kpis.total_dt_done_villages

  return (
    <>
      <HeadlineCard total={total} analysis={analysis} />

      <div className="acc-section"><GitCompareArrows size={13} /> By authority</div>
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

      {/* Its own block, not a third authority card: the gap is the grid's own
          gutter, so the eye reads a new idea rather than a continuation. */}
      <div className="mt-16"><NeedsAttention provinces={provinces} /></div>

      <div className="acc-section"><Layers size={13} /> Work items fully approved (all villages of a site)</div>
      <div className="card">
        {/* Not clickable, deliberately: these count sites, and the queue
            behind every other number on this page is a list of villages.
            A link that lands on something subtly different from the number
            clicked is worse than no link. */}
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
 * Where every village stands, in four states that sum to the universe.
 *
 * This card used to read "fully accepted N · still open M". "Still open" was a
 * residual rather than a state: it merged a village an authority has refused,
 * one sitting with an authority, and one nobody has ever filed — three
 * different jobs. Nothing else on the page could split them, because the two
 * authority pending counts overlap and so cannot be added.
 */
function HeadlineCard({ total, analysis }) {
  const states = [
    {
      key: 'closed', label: 'Accepted', icon: CheckCircle2, color: APPROVED,
      value: analysis.villages_accepted ?? analysis.villages_both_approved ?? 0,
      sub: 'finished — nothing further needed',
    },
    {
      key: 'needs_attention', label: 'Needs an answer', icon: XCircle, color: REJECTED,
      value: analysis.villages_needs_attention ?? 0,
      sub: 'refused, or sent back to the submitter',
    },
    {
      key: 'awaiting_review', label: 'With an authority', icon: Hourglass, color: PENDING,
      value: analysis.villages_in_review ?? 0,
      sub: 'filed, awaiting a verdict',
    },
    {
      key: 'ready', label: 'Never filed', icon: FileQuestion, color: IDLE,
      value: analysis.villages_not_filed ?? 0,
      sub: 'drive test done, no letter sent yet',
    },
  ]
  const accepted = states[0].value
  const pct = total ? Math.round((accepted / total) * 100) : 0

  return (
    <motion.div className="card mt-8" variants={fadeUp} initial="hidden" animate="show">
      <div style={{ padding: '20px 20px 18px' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-muted)', fontSize: 12 }}>
              <BadgeCheck size={15} strokeWidth={2} /> Where every village stands
            </div>
            <div className="row" style={{ alignItems: 'baseline', gap: 12, marginTop: 8 }}>
              <span className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 600, letterSpacing: '-0.02em' }}>
                {accepted}
              </span>
              <span className="dim" style={{ fontSize: 13 }}>
                accepted by ICT <em style={{ fontStyle: 'normal', color: 'var(--text-muted)' }}>and</em> CRA · {pct}% of {total}
              </span>
            </div>
          </div>
          <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            <div className="dim" style={{ fontSize: 11.5 }}>
              DT-Done <span style={{ fontFamily: 'var(--font-farsi)' }}>هدف</span> villages
            </div>
            <div className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, marginTop: 2 }}>
              {total}
            </div>
          </div>
        </div>

        {/* Four segments summing to the universe — no village counted twice,
            none left out, so the bar can be read as a whole. */}
        <div className="split-bar" style={{ marginTop: 16, height: 11 }}>
          {states.map((s) =>
            s.value ? (
              <span key={s.key} style={{ flex: s.value, background: s.color }} title={`${s.label}: ${s.value}`} />
            ) : null
          )}
        </div>
      </div>

      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {states.map((s) => (
          <Cell
            key={s.key}
            icon={s.icon}
            label={s.label}
            value={s.value}
            color={s.color}
            sub={`${total ? Math.round((s.value / total) * 100) : 0}% · ${s.sub}`}
            to={workLink({ bucket: s.key })}
          />
        ))}
      </div>
    </motion.div>
  )
}

function AuthorityCard({ authority, total, approved, rejected, pending }) {
  const { name, where, icon: Icon, color } = authority
  const pct = total ? Math.round((approved / total) * 100) : 0
  const parts = [
    { label: 'Approved', value: approved, color, icon: CheckCircle2, status: 'Approved' },
    { label: 'Rejected', value: rejected, color: REJECTED, icon: XCircle, status: 'Rejected' },
    { label: 'Pending', value: pending, color: PENDING, icon: Hourglass, status: 'Pending' },
  ]
  return (
    <motion.div className="card" variants={fadeUp} initial="hidden" animate="show" style={{ borderTop: `3px solid ${color}` }}>
      <div style={{ padding: '18px 20px 16px' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 7, color, fontSize: 13, fontWeight: 600 }}>
            <Icon size={15} strokeWidth={2} /> {name}
          </div>
          <span className="dim" style={{ fontSize: 11.5 }}>{where}</span>
        </div>

        <div className="row" style={{ alignItems: 'baseline', gap: 10, marginTop: 10 }}>
          <span className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {approved}
          </span>
          <span className="dim" style={{ fontSize: 12.5 }}>approved · {pct}% of {total}</span>
        </div>

        <div className="split-bar" style={{ marginTop: 12 }}>
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
            to={workLink({ authority: name, status: p.status })}
          />
        ))}
      </div>
    </motion.div>
  )
}

/* -------------------------------------------------------- Needs attention */

// A province too small for a rate to mean anything. Without this floor, four
// villages and one approval outranks a province with a hundred outstanding.
const MIN_VOLUME = 20

// Three ways to read the same five rows — not three different lists. This is a
// segmented control rather than tabs for exactly that reason: tabs would say
// the answer changes depending on which you pick, when what changes is the
// order. Every row carries all three numbers whichever is chosen, so nothing
// has to be held in memory to compare them.
const RANKS = {
  outstanding: {
    label: 'Outstanding',
    note: 'villages still outstanding',
    of: (r) => r.remained,
  },
  rate: {
    label: 'Rate',
    note: `share outstanding · provinces under ${MIN_VOLUME} villages excluded`,
    of: (r) => (r.total >= MIN_VOLUME ? r.rate : -1),
  },
  aging: {
    label: 'Aging',
    note: 'oldest outstanding village, measured from its drive test',
    of: (r) => r.oldest ?? -1,
  },
}

const TOP_N = 5

function NeedsAttention({ provinces }) {
  const navigate = useNavigate()
  const [rank, setRank] = useState('outstanding')
  const rule = RANKS[rank]

  // One row per province–authority pair, because that pair is the unit of
  // action: a person telephones one office about one province. Two separate
  // top-fives would also hide which authority owns the worse problem.
  const rows = useMemo(() => {
    const pairs = (provinces || []).flatMap((p) =>
      AUTHORITIES.map((a) => ({
        province: p.name,
        authority: a,
        total: p.total,
        remained: p[`${a.key}_remained`] ?? 0,
        rate: p[`${a.key}_remained_pct`] ?? 0,
        oldest: p[`${a.key}_oldest_age_days`] ?? null,
        buckets: p[`${a.key}_age_buckets`] ?? {},
      }))
    )
    return pairs
      .filter((r) => rule.of(r) > 0)
      .sort((a, b) => rule.of(b) - rule.of(a) || b.remained - a.remained)
      .slice(0, TOP_N)
  }, [provinces, rule])

  if (rows.length === 0) {
    return (
      <div className="card card-pad">
        <div className="empty" style={{ padding: 18 }}>
          Nothing outstanding with either authority.
        </div>
      </div>
    )
  }

  return (
    <motion.div className="card" variants={fadeUp} initial="hidden" animate="show">
      <div className="row" style={{ justifyContent: 'space-between', padding: '18px 20px 14px', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 7 }}>
            <AlertTriangle size={15} style={{ color: PENDING }} /> Needs attention
          </h3>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            Top {TOP_N} province–authority pairs by {rule.note}.
          </div>
        </div>
        <div className="seg" role="group" aria-label="Rank the list by">
          <span className="seg-label">Rank by</span>
          {Object.entries(RANKS).map(([key, r]) => (
            <button
              key={key}
              className={`seg-btn ${rank === key ? 'active' : ''}`}
              aria-pressed={rank === key}
              onClick={() => setRank(key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Province</th>
            <th>Authority</th>
            <th style={{ textAlign: 'right' }}>Outstanding</th>
            <th style={{ textAlign: 'right' }}>Rate</th>
            <th>By age</th>
            <th style={{ textAlign: 'right' }}>Oldest</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const to = workLink({ authority: r.authority.name, status: 'Pending' })
            return (
              <tr key={r.province + r.authority.key}>
                <td className="text-data" style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{r.province}</td>
                <td>
                  <span className={`pill pill-xs ${r.authority.key === 'ict' ? 'pill-cyan' : 'pill-violet'}`}>
                    {r.authority.name}
                  </span>
                </td>
                {/* Both figures on every row, so no re-sort is needed to
                    compare them and the denominator is never hidden. */}
                <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>
                  {r.remained}<span className="dim" style={{ fontWeight: 400 }}> / {r.total}</span>
                </td>
                <td className="tnum" style={{ textAlign: 'right', color: PENDING }}>{r.rate}%</td>
                <td><AgeBar buckets={r.buckets} /></td>
                <td style={{ textAlign: 'right' }}><Age days={r.oldest} /></td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => navigate(to)}
                    aria-label={`Open ${r.province}, awaiting ${r.authority.name}, in My Work`}
                  >
                    Open <ArrowUpRight size={13} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="row" style={{ justifyContent: 'space-between', padding: '11px 20px', borderTop: '1px solid var(--border-soft)', gap: 12, flexWrap: 'wrap' }}>
        <AgeLegend />
        <span className="dim" style={{ fontSize: 11.5 }}>Open lists what is with that authority now.</span>
      </div>
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
        ahead of the other reads without comparing two tables.
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
                  <th key={`${a.key}-o`} style={{ textAlign: 'right' }}>Outstanding</th>,
                  <th key={`${a.key}-g`}>Aging</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {provinces.map((p, i) => (
                <tr key={p.name + i}>
                  <td className="text-data" style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{p.name}</td>
                  <td className="tnum dim" style={{ textAlign: 'right' }}>{p.total}</td>
                  {AUTHORITIES.map((a, j) => {
                    const remained = p[`${a.key}_remained`]
                    return [
                      <td
                        key={`${a.key}-a`}
                        className={`tnum ${j ? 'grp-start' : ''}`}
                        style={{ textAlign: 'right', color: a.color, fontWeight: 500 }}
                      >
                        {p[`${a.key}_approved`]}
                      </td>,
                      <td
                        key={`${a.key}-o`}
                        className="tnum"
                        style={{ textAlign: 'right', color: remained ? PENDING : IDLE }}
                      >
                        {remained}
                      </td>,
                      <td key={`${a.key}-g`}>
                        <span className="row" style={{ gap: 7 }}>
                          <AgeBar buckets={p[`${a.key}_age_buckets`]} width={72} />
                          <Age days={p[`${a.key}_oldest_age_days`]} />
                        </span>
                      </td>,
                    ]
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </>
  )
}
