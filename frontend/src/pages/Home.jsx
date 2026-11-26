import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import { FEATURE, can, landingFor } from '../lib/access'
import { homeFor } from '../lib/roles'
import AppFooter from '../shell/AppFooter'
import { APPS, locate } from '../shell/appRegistry'
import { useHomeData } from '../shell/HomeData'
import AppsPanel from './home/AppsPanel'
import DrillPanel from './home/DrillPanel'
import HomeOverview, { OverviewSkeleton } from './home/HomeOverview'
import RegionSummary from './home/RegionSummary'
import WorkCard from './home/WorkCard'
import { WAITING, allTickets, englishDate, greeting, statusClass, statusLabel, summaryLines } from './home/homeLogic'
import { useRpData } from './reports/rolesPerformance/hooks'
import { formatNumber } from '../lib/numbers'
import '../styles/home.css'

/**
 * UEP Home (UEP-27): greeting; the overview card (To do with its status bar,
 * Waiting on others, Done this week); "Your work" cards, each row with a
 * status strip; and the Apps panel as a tile grid -- from one GET /me/home
 * that the whole shell shares. Fits 1366×768 and up without page scrolling.
 * See docs/design/uep-home.md.
 *
 * Two interactions, kept apart on purpose:
 *
 * - a part of the To do bar, a legend item or Waiting on others **filters the
 *   cards** (`filter`, a toggle; Esc or the "Showing … ×" chip clears it);
 * - every other number **opens the list behind it** in the right-side panel
 *   (`views`, a stack, so Back returns to the previous panel).
 *
 * Two role variants, chosen by the central permission map's `landings`
 * (lib/access.js), built from the same parts:
 *
 * - **region** (Regional manager): no overview and no work cards -- they own
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

function CardsSkeleton() {
  return (
    <div className="hw-grid" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="hw-card">
          <div className="hw-head">
            <span className="h-skel" style={{ width: 28, height: 28 }} />
            <span className="h-skel" style={{ width: '40%', height: 16 }} />
          </div>
          <div className="hw-rows" style={{ padding: 16, gap: 16, display: 'grid' }}>
            <span className="h-skel" style={{ width: '90%', height: 14 }} />
            <span className="h-skel" style={{ width: '70%', height: 14 }} />
            <span className="h-skel" style={{ width: '80%', height: 14 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function FilterChip({ filter, onClear }) {
  return (
    <button type="button" className="hw-clear" onClick={onClear} data-testid="filter-chip">
      <i className={`ho-swatch ${statusClass(filter)}`} aria-hidden="true" />
      Showing {statusLabel(filter).toLowerCase()}
      <Icon name="close" size={16} label="Clear the filter" />
    </button>
  )
}

function YourWork({ data, quiet, filter, onClearFilter, onOpenQueue, onOpenPip }) {
  // A card shows only when its role has at least one live queue in it.
  const cards = data.groups.filter((g) => g.tickets.some((t) => t.count > 0))
  let rowStart = 0
  return (
    <section className="hw-section" aria-labelledby="home-work">
      <div className="hw-title">
        <h2 id="home-work">Your work</h2>
        {filter && <FilterChip filter={filter} onClear={onClearFilter} />}
      </div>
      {cards.length === 0 && quiet ? (
        <p className="h-note" data-testid="work-empty">Nothing is waiting on you.</p>
      ) : cards.length === 0 ? (
        <div className="hw-empty">
          <Icon name="checkmark--outline" size={20} />
          <b>You're all caught up</b>
          <span>New work will appear here.</span>
        </div>
      ) : (
        <div className="hw-grid">
          {cards.map((g, i) => {
            const start = rowStart
            rowStart += g.tickets.length
            return (
              <WorkCard
                key={g.key}
                group={g}
                index={i}
                rowStart={start}
                filter={filter}
                plan={g.key === 'plans' ? data.plan : null}
                onOpenQueue={onOpenQueue}
                onOpenPip={onOpenPip}
              />
            )
          })}
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

/** Home for a Regional manager (landing 'region'). An account not yet linked
 * to provinces never asks for its area, which would only answer 403 (UEP-24
 * F11): it gets a calm empty state instead. */
function RegionHome(props) {
  if (props.user && props.user.kpi_linked === false) return <UnlinkedRegionHome {...props} />
  return <LinkedRegionHome {...props} />
}

function UnlinkedRegionHome({ user, counts, data, error }) {
  return (
    <HomeFrame user={user} footer={<AppFooter data={data} failed={Boolean(error) && !data} />}>
      <div className="h-main">
        <div className="h-work h-work-region">
          <p className="h-note" data-testid="region-empty">No provinces are linked to your account yet. Your administrator can add them.</p>
        </div>
      </div>
      <AppsPanel user={user} counts={counts} expand={['insights']} />
    </HomeFrame>
  )
}

function LinkedRegionHome({ user, counts, data, error }) {
  const region = useRpData('/kpi/area', {})
  const provinces = region.data?.scope?.provinces
  return (
    <HomeFrame user={user} scope={provinces == null ? null : `Your provinces: ${formatNumber(provinces)}`}
      footer={<AppFooter data={data} failed={Boolean(error) && !data} />}>
      <div className="h-main" aria-busy={!region.data && !region.error}>
        <div className="h-work h-work-region"><Region region={region} /></div>
      </div>
      <AppsPanel user={user} counts={counts} expand={['insights']} />
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

/** The app a ticket's page belongs to, for the panel's crumb and colours. */
function appOf(ticket) {
  const [path, search = ''] = ticket.url.split('?')
  return locate(APPS, path, search ? `?${search}` : '').app
}

function lineFor(ticket) {
  const app = appOf(ticket)
  return { ...summaryLines([ticket])[0], appName: app?.name, color: app ? `var(${app.color})` : undefined }
}

/** The filter and the panel stack, and the openers every number calls. */
function useHomeInteractions(data) {
  const [filter, setFilter] = useState(null)
  const [views, setViews] = useState([])
  const tickets = useMemo(() => allTickets(data), [data])

  const toggleFilter = useCallback((key) => setFilter((f) => (f === key ? null : key)), [])
  const clearFilter = useCallback(() => setFilter(null), [])
  const open = useCallback((view) => setViews([view]), [])
  const push = useCallback((view) => setViews((v) => [...v, view]), [])
  const back = useCallback(() => setViews((v) => v.slice(0, -1)), [])
  const close = useCallback(() => setViews([]), [])

  // Esc clears the filter -- unless the panel is open: its own Esc closes it first.
  useEffect(() => {
    if (!filter || views.length) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setFilter(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [filter, views.length])

  const mine = tickets.filter((t) => t.holder === 'self' && t.count > 0)
  const openers = {
    overview: (which) => (which === 'done'
      ? open({ kind: 'done' })
      : open({
        kind: 'summary', title: 'To do', exportTitle: 'To do',
        crumb: `${formatNumber(data.totals.todo)} items where you act next`,
        lines: mine.map(lineFor),
      })),
    queue: (ticket) => {
      const status = filter && filter !== WAITING ? filter : 'all'
      open({ kind: 'list', ticket, crumb: appOf(ticket)?.name || 'UEP', appName: appOf(ticket)?.name, status })
    },
    pip: () => open({ kind: 'pip' }),
    badge: (app) => {
      const ofApp = tickets.filter((t) => t.count > 0 && appOf(t)?.id === app.id)
      const todo = ofApp.filter((t) => t.holder === 'self')
      const lines = (todo.length ? todo : ofApp.filter((t) => t.holder !== 'reminder')).map(lineFor)
      open({
        kind: 'summary', title: app.name, exportTitle: `${app.name} to do`,
        crumb: `${formatNumber(lines.reduce((s, l) => s + l.count, 0))} to do`, lines,
      })
    },
  }
  return { filter, toggleFilter, clearFilter, views, push, back, close, openers }
}

export default function Home() {
  const { user } = useAuth()
  const { data, error, counts, reload } = useHomeData()
  const landing = landingFor(user)
  const ui = useHomeInteractions(data)
  if (landing === 'region') return <RegionHome user={user} counts={counts} data={data} error={error} />

  let overview
  let work
  if (error === 'forbidden') {
    overview = null
    work = (
      <p className="h-note">
        Home isn't available for your role. <Link to={homeFor(user)}>Go to your start page</Link>
      </p>
    )
  } else if (!data && error) {
    overview = <Retry what="Your numbers" onRetry={reload} />
    work = <Retry what="Your work" onRetry={reload} />
  } else if (!data) {
    overview = <OverviewSkeleton />
    work = <CardsSkeleton />
  } else {
    overview = (
      <HomeOverview totals={data.totals} filter={ui.filter} onFilter={ui.toggleFilter} onOpen={ui.openers.overview} />
    )
    work = (
      <YourWork
        data={data}
        quiet={landing === 'work'}
        filter={ui.filter}
        onClearFilter={ui.clearFilter}
        onOpenQueue={ui.openers.queue}
        onOpenPip={user?.role?.name === 'PM' ? ui.openers.pip : null}
      />
    )
  }

  return (
    <HomeFrame user={user} footer={<AppFooter data={data} failed={Boolean(error) && !data} />}>
      <div className="h-main" aria-busy={!data && !error}>
        {overview && <div className="h-kpis">{overview}</div>}
        <div className="h-work">{work}</div>
      </div>
      <AppsPanel user={user} counts={counts} onOpenBadge={data ? ui.openers.badge : null} />
      <DrillPanel
        views={ui.views}
        canExport={can(user, FEATURE.EXPORTS)}
        onPush={ui.push}
        onBack={ui.back}
        onClose={ui.close}
      />
    </HomeFrame>
  )
}
