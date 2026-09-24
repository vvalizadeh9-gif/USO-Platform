import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { EmptyState, PageHead } from '../../components/ui'
import { fmtCount, fmtPct, importStamp } from './kpiTheme'
import {
  ATTRIBUTION_NOTES,
  PARETO_AT,
  barScale,
  checksum,
  decorate,
  rateFraction,
  stretchShort,
  workedExample,
} from './gapRoad'

/**
 * Reports → Gap & Performance.
 *
 * The acceptance pipeline drawn as a road with four barriers — ICT approval,
 * CRA approval, Mojri tracker registration, depreciation — and, for the
 * barrier you select, who is stopped behind it.
 *
 * Four things on this page are rules rather than choices:
 *
 * **The list adds up, visibly.** Under every owner list the page recomputes the
 * total from the rows it just drew and prints the addition in full against the
 * country figure. A design preview of this page showed 2,570 at the top beside
 * an owner list adding to 445, and it reached a person because nothing on the
 * screen ever added the rows up. This is that check, done on every load, by the
 * reader's own eyes.
 *
 * **A rate never appears without its fraction.** "72.5%" alone invites a
 * comparison between an owner with four villages and one with four hundred, so
 * every rate carries "290 of 400 reached" underneath it.
 *
 * **Two different fractions, named apart.** "% of gap" is an owner's share of
 * the national gap; "own rate" is how much of what reached them is stopped. The
 * worked example above the list spells both out using the real top row, because
 * a reader who conflates them calls the wrong person.
 *
 * **The lens row is PM's.** Every other role is confined by the server to its
 * own scope, so the picker does not render for them and their list is their own
 * row. The country total is still shown: it is an aggregate of 31 provinces, it
 * identifies nobody, and "% of gap" cannot be computed without it.
 *
 * The road is hand-built SVG. No charting library, deliberately.
 */
export default function GapRoad() {
  const { user } = useAuth()
  const isPm = user?.role?.name === 'PM'

  const [lens, setLens] = useState(null)
  const [selected, setSelected] = useState('ict')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  // Which lens this account may ask for. PM chooses; every other role is told
  // by the server, through the same endpoint the KPI page asks — one scope
  // rule, one answer, rather than a role list in the browser that can drift
  // out of step with the one the server enforces.
  useEffect(() => {
    let live = true
    api
      .get('/kpi/lenses')
      .then((r) => {
        if (!live) return
        setLens(r.data.selectable ? 'province' : r.data.lens)
      })
      .catch((err) => live && setError(readError(err, 'Could not work out your scope.')))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!lens) return undefined
    let live = true
    setError('')
    setData(null)
    api
      .get('/gaps/road', { params: { lens } })
      .then((r) => live && setData(r.data))
      .catch((err) => live && setError(readError(err, 'Could not load the gap view.')))
    return () => {
      live = false
    }
  }, [lens])

  const stretch = useMemo(
    () => data?.stretches?.find((item) => item.key === selected) ?? null,
    [data, selected]
  )

  const rows = useMemo(
    () => (stretch ? decorate(stretch.owners, stretch.country.stopped) : []),
    [stretch]
  )

  if (error && !data) {
    return (
      <>
        <PageHead eyebrow="Reports" title="Gap &amp; Performance" />
        <div className="card card-pad">
          <EmptyState title="Nothing to show" hint={error} />
        </div>
      </>
    )
  }

  return (
    <div className="kpi gap">
      <PageHead
        eyebrow="Reports"
        title="Gap &amp; Performance"
        subtitle={`Last CPM import · ${importStamp(data?.last_cpm_import)}`}
      />

      {error && data && <div className="kpi-error">{error}</div>}

      {!data ? (
        <Skeleton />
      ) : (
        <>
          <Road
            stretches={data.stretches}
            villages={data.country_villages}
            selected={selected}
            onSelect={setSelected}
          />

          <DataQuality quality={data.data_quality} />

          <section className="card card-pad kpi-card">
            <h3 className="kpi-card-title">
              Stopped before {stretch ? stretchShort(stretch) : '…'}
            </h3>

            {isPm && (
              <LensPills lenses={data.lenses} lens={data.lens} onLens={setLens} />
            )}

            {!isPm && (
              <p className="kpi-banner">
                <Info size={16} aria-hidden="true" />
                Showing your own scope only — {data.lens_label}{' '}
                <strong>{data.key}</strong>. The country total beside it is the
                whole country.
              </p>
            )}

            {stretch && !stretch.available ? (
              <EmptyState
                title="Not recorded yet"
                hint={`${stretch.pending}. Until that lands this stretch reports nothing rather than a guess: with no tracker to look in, counting every CRA-approved village as "not registered" would be a large, confident, wrong number.`}
              />
            ) : (
              <>
                <WorkedExample rows={rows} stretch={stretch} scoped={data.scoped} />
                <OwnerList
                  rows={rows}
                  lensLabel={data.lens_label}
                  scoped={data.scoped}
                />
                <Checksum
                  rows={rows}
                  stretch={stretch}
                  plural={data.lens_plural}
                  scoped={data.scoped}
                />
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function readError(err, fallback) {
  const detail = err?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

/* ---------------------------------------------------------------------------
   The road.

   Four barriers across one lane, left to right in the order a village passes
   them. Each barrier carries the count stopped behind it, and behind each one
   sits a queue block sized against the largest queue on the road, so the
   picture says which barrier is the programme's problem before any number is
   read.

   Hand-built SVG, per this project's convention: no charting library is a
   dependency of the frontend and this page does not add one.
   --------------------------------------------------------------------------- */

// One lane, four equal stretches. The vertical positions are spelled out here
// rather than computed inline so the label, the big figure, the queue and the
// footnote cannot drift into each other when any one of them is moved.
const LANE = { width: 960, height: 168, top: 46, bottom: 150 }
const SEGMENT = LANE.width / 4
const TEXT = {
  label: LANE.top - 18,
  figure: LANE.top + 38,
  unit: LANE.top + 56,
  foot: LANE.bottom - 10,
}
//: The queue sits in its own band between the figure and the footnote, so it
//  never lies under a number.
const QUEUE = { top: LANE.top + 68, height: 16 }

function Road({ stretches, villages, selected, onSelect }) {
  const worst = stretches.reduce(
    (most, item) => Math.max(most, item.country.stopped),
    0
  )

  return (
    <section className="card card-pad kpi-card gap-road-card">
      <header className="gap-road-head">
        <h3 className="kpi-card-title">The road</h3>
        <p className="kpi-note">
          {fmtCount(villages)} target villages travel these four stretches in
          order. A village is <strong>stopped</strong> on a stretch when it
          reached the stretch&apos;s start and not its end. Select a barrier to
          see who is behind it.
        </p>
      </header>

      <svg
        className="gap-road"
        viewBox={`0 0 ${LANE.width} ${LANE.height}`}
        role="group"
        aria-label="The four stretches of the acceptance road"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* The lane itself, under everything. */}
        <rect
          x="0"
          y={LANE.top}
          width={LANE.width}
          height={LANE.bottom - LANE.top}
          className="gap-lane"
          rx="6"
        />

        {stretches.map((item, index) => (
          <Barrier
            key={item.key}
            stretch={item}
            index={index}
            worst={worst}
            selected={item.key === selected}
            onSelect={onSelect}
          />
        ))}
      </svg>
    </section>
  )
}

function Barrier({ stretch, index, worst, selected, onSelect }) {
  const left = index * SEGMENT
  const post = left + SEGMENT - 26
  // A selected barrier is taller as well as tinted: colour alone is not a
  // state, and on the office display this page is read on it is the first
  // thing to disappear.
  const postTop = selected ? LANE.top - 30 : LANE.top - 10
  // Sized against the worst queue on the road, so the picture says which
  // barrier is the programme's problem before a number is read.
  const queue = worst
    ? Math.max(4, (stretch.country.stopped / worst) * (SEGMENT - 54))
    : 4
  const lane = LANE.bottom - LANE.top

  return (
    <g
      className={`gap-barrier ${selected ? 'selected' : ''} ${
        stretch.available ? '' : 'pending'
      }`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${stretch.label}: ${stretch.country.stopped} stopped of ${stretch.country.reached} reached`}
      onClick={() => onSelect(stretch.key)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(stretch.key)
        }
      }}
    >
      {/* The tinted band. Drawn for every barrier so the click target is the
          whole stretch, not the thin post at the end of it. */}
      <rect
        x={left}
        y={LANE.top - 40}
        width={SEGMENT}
        height={lane + 52}
        className="gap-band"
      />

      {/* The queue waiting behind this barrier. */}
      {stretch.available && stretch.country.stopped > 0 && (
        <rect
          x={post - queue - 6}
          y={QUEUE.top}
          width={queue}
          height={QUEUE.height}
          className="gap-queue"
          rx="8"
        />
      )}

      {/* Post and boom: the barrier itself. */}
      <rect x={post} y={postTop} width="6" height={LANE.bottom - postTop} className="gap-post" />
      <rect x={post - 34} y={postTop} width="40" height="7" className="gap-boom" rx="3" />

      <text x={left + 14} y={TEXT.label} className="gap-label">
        {stretch.label}
      </text>
      <text x={left + 14} y={TEXT.figure} className="gap-figure">
        {stretch.available ? fmtCount(stretch.country.stopped) : '—'}
      </text>
      <text x={left + 14} y={TEXT.unit} className="gap-sub">
        {stretch.available ? 'stopped' : 'not recorded yet'}
      </text>
      <text x={left + 14} y={TEXT.foot} className="gap-sub">
        {stretch.available
          ? `${fmtCount(stretch.country.reached)} reached · ${fmtPct(stretch.country.rate)} stopped`
          : stretch.start}
      </text>
    </g>
  )
}

/* ------------------------------------------------------------------------- */

function LensPills({ lenses, lens, onLens }) {
  return (
    <div className="kpi-segmented gap-lens" role="group" aria-label="Lens">
      {lenses.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`kpi-seg ${lens === item.key ? 'active' : ''}`}
          aria-pressed={lens === item.key}
          onClick={() => onLens(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/**
 * What the page will not hide about its own inputs.
 *
 * Each of these is an assumption the design was handed and the schema does not
 * enforce. They are stated where the numbers are read, not in a document
 * nobody opens next to the screen.
 */
function DataQuality({ quality }) {
  const notes = []
  if (quality.cra_approved_without_ict > 0) {
    notes.push(
      `${fmtCount(quality.cra_approved_without_ict)} village(s) are CRA-approved with no ICT approval. ` +
        'The road is drawn ICT-then-CRA; the two authorities are actually parallel. ' +
        'Each of these is counted once, as stopped before ICT.'
    )
  }
  if (quality.villages_without_province > 0) {
    notes.push(
      `${fmtCount(quality.villages_without_province)} village(s) have no province, so no manager, ` +
        'coordinator or CRA region owns them. They are the "Unknown province" row.'
    )
  }
  if (quality.unmapped_provinces.length > 0) {
    notes.push(
      `No current owner in the province mapping for: ${quality.unmapped_provinces.join(', ')}. ` +
        'Their villages are the "Unmapped province" row.'
    )
  }
  if (notes.length === 0) return null

  return (
    <div className="kpi-banner warn gap-quality">
      <AlertTriangle size={16} aria-hidden="true" />
      <span>
        {notes.map((note) => (
          <span key={note}>{note} </span>
        ))}
      </span>
    </div>
  )
}

function WorkedExample({ rows, stretch, scoped }) {
  const sentence = workedExample(rows, stretch, { scoped })
  if (!sentence) return null
  return <p className="gap-example">{sentence}</p>
}

function OwnerList({ rows, lensLabel, scoped }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing on this stretch"
        hint="No villages in scope have reached the start of this stretch yet."
      />
    )
  }

  const scale = barScale(rows)
  const paretoAt = rows.findIndex((row) => row.pareto)

  return (
    <div className="kpi-table-wrap">
      <table className="kpi-table gap-table">
        <thead>
          <tr>
            <th scope="col">{lensLabel}</th>
            <th scope="col">Share of this gap</th>
            <th scope="col">Stopped</th>
            <th scope="col">% of gap</th>
            <th scope="col">Own rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <Row
              key={row.name}
              row={row}
              scale={scale}
              pareto={index === paretoAt && !scoped && rows.length > 1}
              count={index + 1}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Row({ row, scale, pareto, count }) {
  const width = scale ? (row.stopped / scale) * 100 : 0
  const note = ATTRIBUTION_NOTES[row.attribution]
  return (
    <>
      <tr className={row.attribution === 'owned' ? '' : 'gap-unowned'}>
        <th scope="row">
          <span className="kpi-province">{row.name}</span>
          {note && (
            <span className="kpi-region" title={note}>
              {note}
            </span>
          )}
        </th>
        <td>
          <div className="gap-bar">
            <div className="gap-bar-fill" style={{ width: `${width}%` }} />
          </div>
        </td>
        <td className="kpi-plain">{fmtCount(row.stopped)}</td>
        <td className="kpi-plain">{fmtPct(row.shareOfGap)}</td>
        <td className="kpi-plain">
          {fmtPct(row.rate)}
          <em>{rateFraction(row)}</em>
        </td>
      </tr>
      {pareto && (
        <tr className="gap-pareto">
          <td colSpan={5}>
            {PARETO_AT}% of this gap sits in the {count} row
            {count === 1 ? '' : 's'} above this line
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * The live checksum: the rows above, added up in the browser, against the
 * country figure they are supposed to make.
 *
 * It is printed whether or not it balances. A check that only appears when it
 * passes is decoration.
 */
function Checksum({ rows, stretch, plural, scoped }) {
  if (rows.length === 0) return null
  const result = checksum(rows, stretch, { plural, scoped })
  return (
    <p className={`gap-checksum ${result.ok ? '' : 'bad'}`} data-testid="gap-checksum">
      {result.ok ? null : <AlertTriangle size={15} aria-hidden="true" />}
      {result.text}
    </p>
  )
}

function Skeleton() {
  return (
    <div className="kpi-skeleton" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  )
}
