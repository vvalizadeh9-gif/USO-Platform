// Small pieces every Submissions view shares.
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon'
import { Shamsi, gregorianText, shamsiText } from '../../components/DateText'
import { formatNumber } from '../../lib/numbers'
import { plural, splitWidths } from './format'

/** A Shamsi day in Vazirmatn and Persian digits, or a dash. */
export function ShamsiDay({ value }) {
  const text = shamsiText(value)
  return text ? <Shamsi title={gregorianText(value) ?? undefined}>{text}</Shamsi> : <span>—</span>
}

/** A Gregorian day ("2 Sept 2026"), for drive-test dates. */
export function GregorianDay({ value }) {
  return <time dateTime={value || undefined}>{gregorianText(value) ?? '—'}</time>
}

export function Tag({ tone = 'neutral', icon, children }) {
  return (
    <span className="sb-tag" data-tone={tone}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  )
}

export function Dot({ tone }) {
  return <span className="sb-dot" data-tone={tone} aria-hidden="true" />
}

/** A card's tinted header: 36px tile, title, then whatever sits on the right. */
export function CardHead({ icon, tone = 'accent', title, children, id }) {
  return (
    <header className="sb-card-head" data-tone={tone}>
      <span className="sb-tile" data-tone={tone} aria-hidden="true"><Icon name={icon} size={20} /></span>
      <h2 id={id}>{title}</h2>
      {children}
    </header>
  )
}

/** The three view tiles (UEP-21 §4.3): links, the active one solid accent. */
export function ViewTiles({ view, summary }) {
  const s = summary
  const tiles = [
    { id: 'ready', to: '/submissions', label: 'Ready to submit', value: s?.ready.villages,
      aside: s ? plural(s.ready.sites, 'site') : '' },
    { id: 'batches', to: '/submissions?view=batches', label: 'Sent batches', value: s?.batches.sent,
      aside: s ? `${formatNumber(s.batches.waiting)} villages waiting for Mojri` : '' },
    { id: 'follow-up', to: '/submissions?view=follow-up', label: 'Follow up with ICT', value: s?.follow_up.late,
      aside: s?.follow_up.oldest_days != null ? `Oldest ${plural(s.follow_up.oldest_days, 'day')}` : '',
      late: true },
  ]
  return (
    <nav className="sb-tiles" aria-label="Submissions views">
      {tiles.map((t, i) => (
        <Link
          key={t.id}
          to={t.to}
          className={`sb-view ${view === t.id ? 'is-active' : ''}`.trim()}
          aria-current={view === t.id ? 'page' : undefined}
          style={{ '--i': i }}
        >
          <span className="sb-view-text">
            <span className="sb-view-label">{t.label}</span>
            <span className="sb-view-value">{s ? formatNumber(t.value) : <i className="sb-skel sb-skel-figure" />}</span>
          </span>
          <span className={`sb-view-aside ${t.late && t.aside ? 'is-late' : ''}`.trim()}>{t.aside}</span>
        </Link>
      ))}
    </nav>
  )
}

/** Plain, non-link tiles: the read-only coordinator's numbers. */
export function PlainTiles({ tiles }) {
  return (
    <section className="sb-tiles is-plain" aria-label="Your numbers" style={{ '--n': tiles.length }}>
      {tiles.map((t, i) => (
        <div key={t.label} className="sb-view" style={{ '--i': i }}>
          <span className="sb-view-text">
            <span className="sb-view-label">{t.label}</span>
            <span className="sb-view-value">{formatNumber(t.value)}</span>
          </span>
          <span className={`sb-view-aside ${t.late ? 'is-late' : ''}`.trim()}>{t.aside}</span>
        </div>
      ))}
    </section>
  )
}

/** In Mojri (cobalt) · Waiting (yellow) · Follow up (red). */
export function MojriBar({ split, showPct = false }) {
  const w = splitWidths(split)
  if (!w) return <span className="sb-muted">—</span>
  return (
    <span className="sb-mojri">
      <span className="sb-seg" role="img" aria-label={`${w.pct}% in Mojri`}>
        <i className="is-in" style={{ width: w.inMojri }} />
        <i className="is-wait" style={{ width: w.waiting }} />
        <i className="is-late" style={{ width: w.followUp }} />
      </span>
      {showPct && <span className="sb-mojri-pct">{w.pct}%</span>}
    </span>
  )
}

/** A card-sized error with its own retry (never the whole page). */
export function CardError({ message, onRetry }) {
  return (
    <div className="sb-state" role="alert">
      <Icon name="warning--alt" size={20} />
      <b>Couldn't load this.</b>
      <span>{message}</span>
      <button type="button" className="uw-btn uw-btn-sm" onClick={onRetry}>Retry</button>
    </div>
  )
}

/** Skeleton rows in the list's final shape. */
export function SkeletonRows({ rows = 8 }) {
  return (
    <div className="sb-skel-rows" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <i key={i} className="sb-skel sb-skel-row" />)}
    </div>
  )
}

/** "Stale Mojri" (UEP-21 §4.9): the follow-up count pauses on its own. */
export function StaleBanner({ mojri, isPM }) {
  if (!mojri?.stale) return null
  const age = mojri.age_days
  return (
    <div className="sb-banner" role="note">
      <Icon name="warning--alt" size={16} />
      <span>
        <b>{age == null ? 'No Mojri file yet' : `Mojri data is ${plural(age, 'day')} old`}</b>
        {' · '}Follow-up count paused
      </span>
      {isPM && <Link className="uw-btn uw-btn-sm" to="/mojri-tracker">Upload Mojri file</Link>}
    </div>
  )
}
