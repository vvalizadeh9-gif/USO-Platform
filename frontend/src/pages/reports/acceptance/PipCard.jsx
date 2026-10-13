import { Fragment } from 'react'
import Icon from '../../../components/Icon'
import MonthLabel from '../../../components/MonthLabel'
import Section from '../../../components/Section'
import { fmt, monthView, selectableKeys } from './model'

/**
 * One month of one stream against its plans, beside the chart: the Drive
 * test dashboard's "PIP this month" card.
 *
 * What was approved in the month; one row per plan the reader may see
 * (Internal PIP, then Contractor PIP -- "Your PIP" for a contractor), each
 * "{act} of {plan}" over a bar with the Today tick in the running month and
 * one line: how far behind pace and what is left per day, or how the month
 * closed; then, pinned to the bottom, the running totals at the month's end
 * against the reference plan's.
 *
 * Reads the same /acceptance/progress payload as the chart, so the two
 * cannot disagree. Previous and Next stay inside the year, and Next stops at
 * the running month. The month comes from the page (?month=).
 */
export default function PipCard({ state, stream, month, onMonth, isContractor }) {
  const progress = state.data
  const keys = selectableKeys(progress)
  const at = keys.indexOf(month)
  const view = progress ? monthView(progress, stream, month, { isContractor }) : null

  return (
    <Section
      title="PIP"
      tile="calendar"
      inline
      state={state}
      onRetry={state.retry}
      skeletonRows={5}
      className="dt-pip-section acc-pip-section"
      subtitle={view && <MonthLabel label={view.name} suffix={view.isCurrent && ' · in progress'} />}
      actions={
        progress && (
          <span className="acc-steps">
            <button
              type="button"
              className="btn btn-ghost acc-step"
              aria-label="Previous month"
              disabled={at <= 0}
              onClick={() => onMonth(keys[at - 1])}
            >
              <Icon name="chevron--left" size={16} />
            </button>
            <button
              type="button"
              className="btn btn-ghost acc-step"
              aria-label="Next month"
              disabled={at < 0 || at >= keys.length - 1}
              onClick={() => onMonth(keys[at + 1])}
            >
              <Icon name="chevron--right" size={16} />
            </button>
          </span>
        )
      }
    >
      {() => (view ? <PipBody view={view} /> : <div className="dt-empty">No month of this year has started yet.</div>)}
    </Section>
  )
}

function PipBody({ view }) {
  return (
    <div className="acc-pip">
      <div className="acc-pip-head">
        <span className="acc-pip-approved">
          <span className="acc-pip-label">Approved</span>
          <b className="tnum" data-testid="pip-approved">
            {fmt(view.approved)}
          </b>
        </span>
        <span className="acc-pill" data-testid="pip-status">
          {view.status}
        </span>
      </div>

      {view.plans.map((row) => (
        <PlanRow key={row.kind} row={row} />
      ))}

      <dl className="acc-pip-todate" data-testid="pip-to-date">
        <div>
          <dt>Approved to date</dt>
          <dd className="tnum">{fmt(view.toDate.approved)}</dd>
        </div>
        <div>
          <dt>{view.toDate.planLabel}</dt>
          <dd className="tnum">{fmt(view.toDate.plan)}</dd>
        </div>
        {view.toDate.gap && (
          <span className={`acc-pip-gap tnum${view.toDate.gap.tone ? ` acc-tone-${view.toDate.gap.tone}` : ''}`}>
            {view.toDate.gap.text}
          </span>
        )}
      </dl>
    </div>
  )
}

function PlanRow({ row }) {
  return (
    <div className="acc-plan" data-plan={row.kind}>
      <div className="acc-plan-head">
        <span className="acc-plan-name">
          <i className={`acc-key acc-key-${row.kind}`} aria-hidden="true" />
          {row.label}
        </span>
        {!row.noPlan && (
          <span className="acc-plan-figures tnum">
            <b>{fmt(row.act)}</b> of {fmt(row.plan)}
            {row.pct != null && <span className="acc-plan-pct">{row.pct}%</span>}
          </span>
        )}
      </div>
      {!row.noPlan && (
        <div
          className="dt-plan-progress acc-plan-bar"
          role="img"
          aria-label={`${row.label}: ${fmt(row.act)} of ${fmt(row.plan)}${row.pct != null ? `, ${row.pct}%` : ''}`}
        >
          <span className="dt-plan-progress-fill" style={{ width: `${row.bar}%` }} />
          {row.today != null && (
            <span className="dt-plan-pace" style={{ left: `${row.today}%` }} aria-hidden="true" data-testid="pip-today">
              <span className="dt-plan-pace-label">Today</span>
            </span>
          )}
        </div>
      )}
      <p className="acc-plan-line" data-testid="pip-line">
        {row.line.map((part, i) => (
          <Fragment key={i}>
            {i > 0 && ' · '}
            <span className={part.tone ? `acc-tone-${part.tone}` : undefined}>
              {part.strong ? <b>{part.text}</b> : part.text}
            </span>
          </Fragment>
        ))}
      </p>
    </div>
  )
}
