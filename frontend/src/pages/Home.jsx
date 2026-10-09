import { motion, MotionConfig } from 'framer-motion'
import { ChartColumn, CircleCheck, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client'
import { Banner, stagger } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { DATA_CHANGED_EVENT } from '../lib/dataChanged'
import { greetingFor, gregorianLabel } from '../lib/greeting'
import { NAV_SECTIONS, navItemVisible } from '../lib/nav'
import { homeFor, roleLabel } from '../lib/roles'
import AppsPanel from './home/AppsPanel'
import HomeFooter from './home/HomeFooter'
import HomeHeader from './home/HomeHeader'
import KpiStrip from './home/KpiStrip'
import WorkCard from './home/WorkCard'
import '../styles/home.css'

/**
 * UEP Home: how much is waiting on you, what is late or due soon, the one
 * thing to do next, and every app you can open. One request
 * (GET /home/summary); every number on it is the Action Center's own.
 * See docs/design/uep-home.md.
 */

const REFRESH_MS = 60000

/** The first dashboard this role can open: where "View reports" goes. */
function reportsPathFor(roleName) {
  const item = NAV_SECTIONS.flatMap((s) => s.items).find(
    (i) => i.to.startsWith('/reports/') && navItemVisible(i, roleName),
  )
  return item?.to || '/reports/drive-test'
}

function Skeleton() {
  // The final layout's geometry, so nothing moves when the numbers arrive.
  return (
    <>
      <section className="h-card h-kpis" aria-hidden="true">
        <div className="h-hero" style={{ opacity: 0.35 }} />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-k">
            <span className="h-skel h-skel-text" style={{ width: '60%' }} />
            <span className="h-skel" style={{ width: 64, height: 40 }} />
            <span className="h-skel h-skel-text" style={{ width: '80%' }} />
          </div>
        ))}
      </section>
      <section className="h-work" aria-hidden="true">
        <span className="h-skel h-skel-text" style={{ width: 160, height: 22 }} />
        <div className="h-grid" data-cols="3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-card" style={{ padding: 20, gap: 14 }}>
              <span className="h-skel h-skel-text" style={{ width: '50%', height: 20 }} />
              <span className="h-skel h-skel-text" style={{ width: '90%' }} />
              <span className="h-skel h-skel-text" style={{ width: '70%' }} />
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

function SlaLabel({ data }) {
  if (data.sla_uniform_days) return <span className="h-sla">SLA {data.sla_uniform_days} days</span>
  const days = Object.values(data.sla_days || {})
  if (days.length === 0) return null
  return (
    <span className="h-sla" title={Object.entries(data.sla_days).map(([k, d]) => `${k}: ${d} days`).join('\n')}>
      SLA per queue
    </span>
  )
}

function YourWork({ data }) {
  const groups = [...data.groups]
  // A coordinator's board has no Plans queue, but their month's plan still
  // belongs on the page: it gets a Plans card of its own.
  if (data.plan && !groups.some((g) => g.key === 'plans')) {
    groups.push({ key: 'plans', label: 'Plans', tickets: [] })
  }
  const nothing = data.totals.pending === 0

  return (
    <section className="h-work" aria-labelledby="home-work">
      <div className="h-work-head">
        <h2 id="home-work">Your work</h2>
        <SlaLabel data={data} />
        <span className="h-legend" aria-hidden="true">
          <span><i style={{ background: 'var(--h-dot)' }} />On time</span>
          <span><i style={{ background: 'var(--soon-dot)' }} />Due soon</span>
          <span><i style={{ background: 'var(--late-dot)' }} />Late</span>
        </span>
      </div>
      {nothing && !data.plan ? (
        <div className="h-card h-empty">
          <CircleCheck size={28} strokeWidth={2} aria-hidden="true" />
          <b>Nothing waiting on you</b>
          <span>New work shows up here as soon as it reaches you.</span>
        </div>
      ) : (
        <motion.div
          className="h-grid"
          data-cols={Math.min(3, groups.length)}
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          {groups.map((g) => (
            <WorkCard
              key={g.key}
              group={g}
              upNext={data.up_next}
              plan={g.key === 'plans' ? data.plan : null}
            />
          ))}
        </motion.div>
      )}
    </section>
  )
}

export default function Home() {
  const { user, logout } = useAuth()
  const roleName = user?.role?.name
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [now, setNow] = useState(() => new Date())

  const load = useCallback(() => {
    return api
      .get('/home/summary')
      .then((r) => {
        setData(r.data)
        setError(null)
        setNow(new Date())
      })
      .catch((e) => setError(e?.response?.status === 403 ? 'forbidden' : 'failed'))
  }, [])

  // Once on open, after any write anywhere in the app (the counts move when
  // an action does), and on a light interval -- the same rhythm as the
  // sidebar's badges.
  useEffect(() => {
    let pending = null
    const onChange = () => {
      clearTimeout(pending)
      pending = setTimeout(load, 300)
    }
    load()
    const id = setInterval(load, REFRESH_MS)
    window.addEventListener(DATA_CHANGED_EVENT, onChange)
    return () => {
      clearInterval(id)
      clearTimeout(pending)
      window.removeEventListener(DATA_CHANGED_EVENT, onChange)
    }
  }, [load])

  const firstName = user?.first_name || (user?.full_name || '').split(' ')[0]

  let body
  if (error === 'forbidden') {
    body = (
      <Banner tone="info" title="Home isn't available for your role">
        <Link to={homeFor(roleName)}>Go to your start page</Link>
      </Banner>
    )
  } else if (error && !data) {
    body = (
      <Banner tone="error" title="Your work didn't load.">
        <span className="h-error">
          Check your connection and try again.
          <button type="button" className="h-pill quiet" onClick={load}>
            <RefreshCw size={16} aria-hidden="true" />
            Retry
          </button>
        </span>
      </Banner>
    )
  } else if (!data) {
    body = <Skeleton />
  } else {
    body = (
      <>
        <KpiStrip totals={data.totals} slaDays={data.sla_uniform_days} dueSoonDays={data.due_soon_days} />
        <YourWork data={data} />
      </>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="uep-home">
        <HomeHeader user={user} logout={logout} />
        <div className="h-body">
          <main className="h-main" aria-busy={!data && !error}>
            <section className="h-greet">
              <div>
                <div className="h-eyebrow">
                  {gregorianLabel(now)} · {roleLabel(roleName)}
                </div>
                <h1 className="h-title">
                  {greetingFor(now)}{firstName ? `, ${firstName}` : ''}
                </h1>
              </div>
              <Link to={reportsPathFor(roleName)} className="h-pill quiet">
                <ChartColumn size={16} strokeWidth={2.2} aria-hidden="true" />
                View reports
              </Link>
            </section>
            {body}
          </main>
          <AppsPanel roleName={roleName} badges={data?.app_badges} />
        </div>
        <HomeFooter generatedAt={data?.generated_at} />
      </div>
    </MotionConfig>
  )
}
