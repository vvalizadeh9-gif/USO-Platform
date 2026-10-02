// Area (PM, Viewer) and My area (everyone else): where things stand today.
// Six headline cards, a breakdown, and the open work -- each linking to
// Lifecycle Gaps, never to a village list on this page.
import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { SegmentedControl } from '../../../components/ui'
import { useAuth } from '../../../context/AuthContext'
import { hasActionCenter } from '../../../lib/roles'
import { importStamp } from '../kpiTheme'
import PerfHeader from './PerfHeader'
import ScopePicker from './ScopePicker'
import { useExport, useRpData } from './hooks'
import { CountUp, NotCompared, Num, RateBar, RpCard } from './parts'
import { fmtCount, fmtPct, scopeParams } from './model'

const BREAKDOWN_LABELS = { province: 'Provinces', region: 'CRA regions', contractor: 'Contractors' }

export default function AreaTab({ scope, onScope, search }) {
  const { user } = useAuth()
  const [breakdown, setBreakdown] = useState(null)
  const params = { ...scopeParams(scope), ...(breakdown ? { breakdown } : {}) }
  const { data, error, loading } = useRpData('/kpi/area', params)
  const exporter = useExport('/kpi/area.xlsx', params, 'UEP-roles-area.xlsx')
  const shown = data?.breakdown ?? breakdown

  return (
    <>
      <PerfHeader
        tab="area"
        scopeLabel={data?.scope?.label ?? 'Whole country'}
        title={<ScopePicker scope={scope} onChange={onScope} />}
        chip={data?.scope?.chip}
        search={search}
        dateControl={
          <span className="rp-stamp">As of today · CPM import {importStamp(data?.as_of)}</span>
        }
        onExport={exporter.run}
        exporting={exporter.busy}
        exportError={exporter.error}
      />
      <div className="rp-body rp-area">
        {data?.scope?.past && (
          <p className="rp-state">
            {data.scope.key} owns no province today. Their past months are in Performance.
          </p>
        )}
        <div className="rp-cards6">
          {(data?.cards ?? Array.from({ length: 6 }, (_, i) => ({ key: i }))).map((card, i) => (
            <HeadlineCard key={card.key} card={card} loading={loading && !data} error={error}
              index={i} />
          ))}
        </div>
        <div className="rp-area-lower">
          <RpCard
            className="rp-card-fill rp-rise"
            title="Breakdown"
            aside={data && (
              <SegmentedControl
                options={data.breakdowns.map((key) => ({ key, label: BREAKDOWN_LABELS[key] }))}
                value={shown}
                onChange={setBreakdown}
                label="Breakdown by"
              />
            )}
            loading={loading && !data}
            error={error}
            empty={data && !data.rows.length}
          >
            {data && <BreakdownTable data={data} />}
          </RpCard>
          <RpCard className="rp-rise" title="Open work" loading={loading && !data} error={error}>
            {data && (
              <OpenWork
                items={data.open_work}
                actionCenter={hasActionCenter(user?.role?.name)}
              />
            )}
          </RpCard>
        </div>
      </div>
    </>
  )
}

function HeadlineCard({ card, loading, error, index }) {
  return (
    <RpCard className="rp-headline rp-rise" style={{ '--rp-delay': `${index * 90}ms` }}
      loading={loading} error={error}>
      {card.label && (
        <>
          <p className="rp-headline-label">{card.label}</p>
          <p className="rp-headline-figure">
            <CountUp value={card.count} className="rp-figure" />
            {card.rate != null && <Num className="rp-headline-rate">{fmtPct(card.rate)}</Num>}
          </p>
          {card.rate != null && (
            <RateBar value={card.rate} tick={card.national_rate}
              label={`${fmtPct(card.rate)}; national ${fmtPct(card.national_rate)}`} />
          )}
          <p className="rp-headline-base">
            of <Num>{fmtCount(card.base)}</Num> {card.base_label}
            {card.national_rate != null && <> · national <Num>{fmtPct(card.national_rate)}</Num></>}
            {card.remaining != null && <> · <Num>{fmtCount(card.remaining)}</Num> remaining</>}
          </p>
        </>
      )}
    </RpCard>
  )
}

function gapsLink(breakdown, row) {
  if (!row.gaps_key) return '/reports/gaps'
  return `/reports/gaps?${new URLSearchParams({ lens: breakdown, key: row.gaps_key })}`
}

function BreakdownTable({ data }) {
  return (
    <div className="rp-table-scroll">
      <table className="rp-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Villages: DT done · on air · not on air</th>
            <th scope="col">ICT</th>
            <th scope="col">CRA</th>
            <th scope="col" className="rp-right">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.name} className={row.low_sample ? 'rp-low' : undefined}>
              <th scope="row">
                <Link to={gapsLink(data.breakdown, row)} className="rp-row-link">
                  <span dir="auto">{row.name}</span>
                </Link>
                <span className="rp-row-sub"><Num>{fmtCount(row.villages)}</Num> villages</span>
              </th>
              <td><StackBar row={row} /></td>
              <td><AuthorityRate cell={row.ict} low={row.low_sample} colour="var(--rp-ict)" /></td>
              <td><AuthorityRate cell={row.cra} low={row.low_sample} colour="var(--rp-cra)" /></td>
              <td className="rp-right"><Num>{fmtCount(row.remaining)}</Num></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StackBar({ row }) {
  const total = row.villages || 1
  const parts = [
    ['dt', row.dt_done, 'DT done'],
    ['air', row.on_air_only, 'on air'],
    ['off', row.not_on_air, 'not on air'],
  ]
  return (
    <span className="rp-stack" role="img"
      aria-label={parts.map(([, n, label]) => `${n} ${label}`).join(', ')}>
      <span className="rp-stack-bar">
        {parts.map(([key, n]) => (
          <span key={key} className={`rp-stack-${key}`} style={{ width: `${(n / total) * 100}%` }} />
        ))}
      </span>
      <Num className="rp-stack-counts">
        {fmtCount(row.dt_done)} · {fmtCount(row.on_air_only)} · {fmtCount(row.not_on_air)}
      </Num>
    </span>
  )
}

function AuthorityRate({ cell, low, colour }) {
  if (low) return <NotCompared />
  return (
    <span className="rp-authority">
      <Num>{fmtPct(cell.rate)}</Num>
      <RateBar value={cell.rate} tick={cell.national} colour={colour}
        label={`${fmtPct(cell.rate)}; national ${fmtPct(cell.national)}`} />
    </span>
  )
}

function OpenWork({ items, actionCenter }) {
  return (
    <>
      <ul className="rp-open">
        {items.map((item) => (
          <li key={item.key}>
            <Link to="/reports/gaps" className="rp-open-link">
              <span>{item.label}</span>
              <Num className="rp-open-count">{fmtCount(item.count)}</Num>
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
      {actionCenter && (
        <Link to="/action-center" className="rp-button rp-button-block">
          Open my Action Center
        </Link>
      )}
    </>
  )
}
