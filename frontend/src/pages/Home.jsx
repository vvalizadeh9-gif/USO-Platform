import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../lib/roles'
import AppFooter from '../shell/AppFooter'
import { useHomeData } from '../shell/HomeData'
import AppsPanel from './home/AppsPanel'
import KpiStrip from './home/KpiStrip'
import WorkCard from './home/WorkCard'
import { englishDate, greeting } from './home/homeLogic'
import '../styles/home.css'

/**
 * UEP Home (UEP-02 §3): greeting, four KPIs, "Your work" cards and the Apps
 * panel, from one GET /me/home that the whole shell shares. Fits 1440×900
 * without page scrolling. The greeting spans the page; under it the Apps
 * panel shares the KPI strip's top edge and the work cards' bottom edge
 * (UEP-12). See docs/design/uep-home.md.
 */

function Retry({ what, onRetry }) {
  return (
    <div className="h-error" role="alert">
      <Icon name="warning--alt" size={16} />
      <span>{what} didn't load.</span>
      <button type="button" onClick={onRetry}>Retry</button>
    </div>
  )
}

function KpiSkeleton() {
  return (
    <div className="hk-wrap" aria-hidden="true">
      <div className="hk-strip">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`hk-tile is-skel ${i === 0 ? 'is-hero' : ''}`.trim()}>
            <span className="h-skel" style={{ width: '60%', height: 14 }} />
            <span className="h-skel" style={{ width: 56, height: 40 }} />
            <span className="h-skel" style={{ width: '50%', height: 14 }} />
            <span className="h-skel" style={{ width: '100%', height: 28 }} />
          </div>
        ))}
      </div>
      <p className="hk-caption">&nbsp;</p>
    </div>
  )
}

function CardsSkeleton() {
  return (
    <div className="hw-grid" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="hw-card">
          <div className="hw-head">
            <span className="h-skel" style={{ width: 36, height: 36 }} />
            <span className="h-skel" style={{ width: '40%', height: 18 }} />
          </div>
          <div className="hw-rows" style={{ padding: 16, gap: 16, display: 'grid' }}>
            <span className="h-skel" style={{ width: '90%', height: 14 }} />
            <span className="h-skel" style={{ width: '70%', height: 14 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function YourWork({ data }) {
  // A card shows only when its role has at least one live queue in it.
  const cards = data.groups.filter((g) => g.tickets.some((t) => t.count > 0))
  return (
    <section className="hw-section" aria-labelledby="home-work">
      <div className="hw-title">
        <h2 id="home-work">Your work</h2>
        {data.sla_uniform_days && <span>SLA {data.sla_uniform_days} days</span>}
      </div>
      {cards.length === 0 ? (
        <div className="hw-empty">
          <Icon name="task" size={20} />
          <b>You're all caught up</b>
          <span>New work will appear here.</span>
        </div>
      ) : (
        <div className="hw-grid">
          {cards.map((g) => (
            <WorkCard
              key={g.key}
              group={{ ...g, tickets: g.tickets.filter((t) => t.count > 0) }}
              plan={g.key === 'plans' ? data.plan : null}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default function Home() {
  const { user } = useAuth()
  const { data, error, counts, reload } = useHomeData()
  const roleName = user?.role?.name
  const now = new Date()
  const firstName = user?.first_name || (user?.full_name || '').split(' ')[0]

  let kpis
  let work
  if (error === 'forbidden') {
    kpis = null
    work = (
      <p className="h-note">
        Home isn't available for your role. <Link to={homeFor(roleName)}>Go to your start page</Link>
      </p>
    )
  } else if (!data && error) {
    kpis = <Retry what="Your numbers" onRetry={reload} />
    work = <Retry what="Your work" onRetry={reload} />
  } else if (!data) {
    kpis = <KpiSkeleton />
    work = <CardsSkeleton />
  } else {
    kpis = <KpiStrip totals={data.totals} trends={data.trends} />
    work = <YourWork data={data} />
  }

  return (
    <div className="uep-home">
      <div className="h-layout">
        <section className="h-greet">
          <p className="h-date">{englishDate(now)}</p>
          <h1>{greeting(now)}{firstName ? `, ${firstName}` : ''}</h1>
        </section>
        <div className="h-main" aria-busy={!data && !error}>
          {kpis && <div className="h-kpis">{kpis}</div>}
          <div className="h-work">{work}</div>
        </div>
        <AppsPanel roleName={roleName} counts={counts} />
      </div>
      <AppFooter data={data} failed={Boolean(error) && !data} />
    </div>
  )
}
