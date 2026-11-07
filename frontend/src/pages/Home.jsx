import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import { landingFor } from '../lib/access'
import { homeFor } from '../lib/roles'
import AppFooter from '../shell/AppFooter'
import { useHomeData } from '../shell/HomeData'
import AppsPanel from './home/AppsPanel'
import KpiStrip from './home/KpiStrip'
import RegionSummary from './home/RegionSummary'
import WorkCard from './home/WorkCard'
import { englishDate, greeting } from './home/homeLogic'
import { useRpData } from './reports/rolesPerformance/hooks'
import { formatNumber } from '../lib/numbers'
import '../styles/home.css'

/**
 * UEP Home (UEP-02 §3): greeting, four KPIs, "Your work" cards and the Apps
 * panel, from one GET /me/home that the whole shell shares. Fits 1440×900
 * without page scrolling. The greeting spans the page; under it the Apps
 * panel shares the KPI strip's top edge and the work cards' bottom edge
 * (UEP-12). See docs/design/uep-home.md.
 *
 * Two role variants, chosen by the central permission map's `landings`
 * (lib/access.js), built from the same parts:
 *
 * - **region** (Regional manager): no KPI strip and no work cards -- they own
 *   no tasks -- but their region today, from Roles performance › My area, and
 *   an Apps panel of exactly Roles performance, Lifecycle gaps and Explorer.
 * - **work** (the five problem-category owners): the standard Home, counting
 *   only their own items; with nothing waiting, one quiet line.
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

function YourWork({ data, quiet }) {
  // A card shows only when its role has at least one live queue in it.
  const cards = data.groups.filter((g) => g.tickets.some((t) => t.count > 0))
  return (
    <section className="hw-section" aria-labelledby="home-work">
      <div className="hw-title">
        <h2 id="home-work">Your work</h2>
        {data.sla_uniform_days && <span>SLA {data.sla_uniform_days} days</span>}
      </div>
      {cards.length === 0 && quiet ? (
        <p className="h-note" data-testid="work-empty">Nothing is waiting on you.</p>
      ) : cards.length === 0 ? (
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

/** The region landing's left side: loading, error, or the summary. */
function Region({ region }) {
  if (region.data) return <RegionSummary data={region.data} />
  if (region.error) {
    return (
      <div className="h-error" role="alert">
        <Icon name="warning--alt" size={16} />
        <span>{region.error}</span>
        <button type="button" onClick={region.retry}>Retry</button>
      </div>
    )
  }
  return <CardsSkeleton />
}

/** Home for a Regional manager (landing 'region'). */
function RegionHome({ user, counts, data, error }) {
  const region = useRpData('/kpi/area', {})
  const provinces = region.data?.scope?.provinces
  return (
    <HomeFrame user={user} scope={provinces == null ? null : `Your provinces: ${formatNumber(provinces)}`}
      footer={<AppFooter data={data} failed={Boolean(error) && !data} />}>
      <div className="h-main" aria-busy={!region.data && !region.error}>
        <div className="h-work h-work-region"><Region region={region} /></div>
      </div>
      <AppsPanel roleName={user?.role?.name} counts={counts} expand={['insights']} />
    </HomeFrame>
  )
}

/** The page around either variant: greeting, date, the grid and the footer. */
function HomeFrame({ user, scope, footer, children }) {
  const now = new Date()
  const firstName = user?.first_name || (user?.full_name || '').split(' ')[0]
  return (
    <div className="uep-home uep-home-page">
      <div className="h-layout">
        <section className="h-greet">
          <p className="h-date">{englishDate(now)}</p>
          <h1>{greeting(now)}{firstName ? `, ${firstName}` : ''}</h1>
          {scope && <p className="h-date h-scope" data-testid="home-scope">{scope}</p>}
        </section>
        {children}
      </div>
      {footer}
    </div>
  )
}

export default function Home() {
  const { user } = useAuth()
  const { data, error, counts, reload } = useHomeData()
  const roleName = user?.role?.name
  const landing = landingFor(roleName)
  if (landing === 'region') return <RegionHome user={user} counts={counts} data={data} error={error} />

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
    work = <YourWork data={data} quiet={landing === 'work'} />
  }

  return (
    <HomeFrame user={user} footer={<AppFooter data={data} failed={Boolean(error) && !data} />}>
      <div className="h-main" aria-busy={!data && !error}>
        {kpis && <div className="h-kpis">{kpis}</div>}
        <div className="h-work">{work}</div>
      </div>
      <AppsPanel roleName={roleName} counts={counts} />
    </HomeFrame>
  )
}
