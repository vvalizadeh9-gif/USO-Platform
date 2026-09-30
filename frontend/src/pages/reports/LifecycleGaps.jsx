import { useEffect, useState } from 'react'
import { AlertTriangle, ClipboardList, Hourglass, Scale } from 'lucide-react'
import api from '../../api/client'
import ExportNumber, { ExportFeedback } from '../../components/ExportNumber'
import GapDrawer from '../../components/GapDrawer'
import PageFrame from '../../components/PageFrame'
import WaffleTile from '../../components/WaffleTile'
import { useAuth } from '../../context/AuthContext'
import { Banner, Card, EmptyState, PageBar, Tabs } from '../../components/ui'
import CoverageMap from './CoverageMap'
import {
  ATTRIBUTION_NOTES,
  CARDS,
  GAPS,
  LENSES,
  checksum,
  dataNotes,
  drawerRows,
  fmt,
  hasData,
  holdersParts,
  lensNoun,
  mojriStamp,
  onePct,
  scaleNote,
  shareParts,
  waffleFilled,
} from './lifecycleGaps'

/**
 * Performance → Lifecycle Gaps.
 *
 * Clean first, detail on demand. At rest the Gaps tab is six numbers in three
 * cards -- pending approval, one approved and the other pending, approved but
 * missing from Mojri's tracker -- each a waffle of its gap against its base.
 * Who is holding a gap opens in a drawer on click.
 *
 * Rules rather than choices:
 *
 * **ICT left, CRA right, in every card**, each in its authority colour and
 * always with its chip. Cobalt is never a data colour here: it marks the tile
 * whose drawer is open, and nothing else.
 *
 * **The drawer adds up, visibly.** Its footer sums the rows it received and
 * says out loud whether they make the gap's total.
 *
 * **The lens is PM's.** Every other role is confined by the server to its own
 * villages, so the drawer shows their own row and no Group-by control.
 *
 * **The page never scrolls.** The cards fit; the drawer is fixed over a scrim
 * and its list scrolls inside it.
 */
export default function LifecycleGaps() {
  const { user } = useAuth()
  const isPm = user?.role?.name === 'PM'

  const [lens, setLens] = useState(null)
  const [tab, setTab] = useState('gaps')
  const [selected, setSelected] = useState(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  // Which lens this account may ask for. PM chooses; every other role is told
  // by the server, through the same endpoint the KPI page asks -- one scope
  // rule, one answer, rather than a role list in the browser.
  useEffect(() => {
    let live = true
    api
      .get('/kpi/lenses')
      .then((r) => live && setLens(r.data.selectable ? LENSES[0].key : r.data.lens))
      .catch((err) => live && setError(readError(err, 'Could not work out your scope.')))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!lens) return undefined
    let live = true
    setError('')
    api
      .get('/gaps/overview', { params: { lens } })
      .then((r) => live && setData(r.data))
      .catch((err) => live && setError(readError(err, 'Could not load the gaps.')))
    return () => {
      live = false
    }
  }, [lens])

  const notes = dataNotes(data?.data_quality)

  const bar = (
    <PageBar
      eyebrow="Performance"
      title="Lifecycle Gaps"
      actions={
        <>
          {notes.length > 0 && (
            <button
              type="button"
              className="gap-note-btn"
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((open) => !open)}
            >
              <AlertTriangle size={18} aria-hidden="true" />
              {notes.length} data {notes.length === 1 ? 'note' : 'notes'}
            </button>
          )}
          {data && (
            <span className="gap-total" data-testid="gap-total">
              <strong className="tnum">{fmt(data.totals.eligible)}</strong> villages with drive
              test done
            </span>
          )}
        </>
      }
      tabs={<Tabs tabs={TABS} value={tab} onChange={setTab} label="Gap views" />}
    />
  )

  return (
    <ExportFeedback>
      <PageFrame className="gap-page" bar={bar}>
        {notesOpen && notes.length > 0 && (
          <Banner tone="warning" title="Data quality.">
            {notes.map((note) => (
              <span key={note}>{note} </span>
            ))}
          </Banner>
        )}
        {error && data && <Banner tone="error">{error}</Banner>}

        {tab === 'map' ? (
          <CoverageMap />
        ) : error && !data ? (
          <Card>
            <EmptyState title="Nothing to show" hint={error} />
          </Card>
        ) : !data ? (
          <Skeleton />
        ) : (
          <GapsTab
            data={data}
            lens={lens}
            isPm={isPm}
            selected={selected}
            onSelect={setSelected}
            onLens={setLens}
          />
        )}
      </PageFrame>
    </ExportFeedback>
  )
}

const TABS = [
  { key: 'gaps', label: 'Gaps' },
  { key: 'map', label: 'Coverage map' },
]

const CARD_ICONS = { pending: Hourglass, remained: Scale, mojri: ClipboardList }

function readError(err, fallback) {
  const detail = err?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

/* ---------------------------------------------------------------------------
   The Gaps tab: three cards, six tiles, one legend line.
   --------------------------------------------------------------------------- */

function GapsTab({ data, lens, isPm, selected, onSelect, onLens }) {
  return (
    <div className="gap-tab">
      <div className="gap-cards">
        {CARDS.map((card) => (
          <Card
            key={card.key}
            icon={CARD_ICONS[card.key]}
            title={card.title}
            titleAs="h3"
            description={card.description}
            className="gap-card"
          >
            <div className="gap-tiles">
              {card.gaps.map((key) => (
                <GapTile
                  key={key}
                  gapKey={key}
                  data={data}
                  selected={selected === key}
                  onOpen={() => onSelect(key)}
                />
              ))}
            </div>
          </Card>
        ))}
      </div>

      <p className="gap-legend">
        <span>
          <i className="gap-swatch" aria-hidden="true" />
          Pending
        </span>
        <span>
          <i className="gap-swatch gap-swatch-base" aria-hidden="true" />
          Counted from (100 squares = the base)
        </span>
        <span className="gap-legend-hint">
          Select a tile to see who is holding it · select a number to export its villages to Excel
        </span>
      </p>

      {selected && (
        <HoldersDrawer
          gapKey={selected}
          data={data}
          lens={lens}
          isPm={isPm}
          onLens={onLens}
          onClose={() => onSelect(null)}
        />
      )}
    </div>
  )
}

function GapTile({ gapKey, data, selected, onOpen }) {
  const meta = GAPS[gapKey]
  const gap = data.gaps[gapKey]
  const ready = hasData(gapKey, data)
  const share = shareParts(gapKey, gap)
  const approved = meta.approvedGap && data.totals[meta.approvedGap]

  return (
    <WaffleTile
      authority={meta.authority}
      label={meta.tileLabel}
      filled={waffleFilled(gap.count, gap.base)}
      figure={<GapFigure gap={gapKey} value={gap.count} className="waffle-tile-number" />}
      share={
        <>
          <strong>{share.pct}</strong> {share.of} <span className="nowrap">{share.name}</span>
        </>
      }
      scale={scaleNote(gap.base)}
      breakdown={meta.mojri && ready ? mojriBreakdown(gap) : null}
      selected={selected}
      empty={!ready}
      emptyNote="No Mojri import yet"
      emptyFigure={
        meta.mojri && (
          <>
            <GapFigure gap={meta.approvedGap} value={approved} /> approved in UEP
          </>
        )
      }
      openLabel={
        ready
          ? `${meta.authority} ${meta.tileLabel}: ${fmt(gap.count)} villages — see who is holding it`
          : `${meta.authority} ${meta.tileLabel}: no Mojri import yet`
      }
      onOpen={onOpen}
    />
  )
}

/**
 * What a Mojri tile's figure is made of, from counts the API already sends:
 * the figure is every approved village not `in_tracker`, so it is the
 * needs-a-look villages plus the ones simply missing.
 */
function mojriBreakdown(gap) {
  const needsLook = gap.needs_look ?? 0
  const missing = Math.max(0, gap.count - needsLook)
  return `In Mojri ${fmt(gap.in_tracker ?? 0)} · Needs a look ${fmt(needsLook)} · Missing ${fmt(missing)}`
}

/** A village count on this page: always an export of the villages it counts. */
function GapFigure({ gap, value, lens, keyValue, className }) {
  return (
    <ExportNumber value={value} gap={gap} lens={lens} keyValue={keyValue} className={className} />
  )
}

/* ---------------------------------------------------------------------------
   The drawer: who is holding the selected gap.
   --------------------------------------------------------------------------- */

function HoldersDrawer({ gapKey, data, lens, isPm, onLens, onClose }) {
  const meta = GAPS[gapKey]
  const gap = data.gaps[gapKey]
  const ready = hasData(gapKey, data)
  const card = CARDS.find((item) => item.key === meta.card)
  // Until the new lens arrives, the rows on screen are the old lens's.
  const loading = data.lens !== lens
  const shownLens = data.lens
  const rows = drawerRows(data.rows[gapKey] ?? [], gap.count).map((row) => ({
    ...row,
    note: ATTRIBUTION_NOTES[row.attribution],
    sub: row.managers?.length ? `RM ${row.managers.join(', ')}` : null,
  }))
  const check = checksum(rows, gap.count)
  const holders = holdersParts(rows, shownLens, gap.count)

  return (
    <GapDrawer
      open
      onClose={onClose}
      eyebrow={card.title}
      authority={meta.authority}
      title={meta.title}
      hero={{
        empty: !ready,
        filled: waffleFilled(gap.count, gap.base),
        figure: ready ? <GapFigure gap={gapKey} value={gap.count} /> : '—',
        line: ready
          ? `${onePct(gap.count, gap.base)} of ${fmt(gap.base)} ${meta.baseName}`
          : 'No Mojri import yet',
        note: meta.mojri && ready ? mojriStamp(data.last_mojri_import) : null,
      }}
      lens={isPm ? lens : shownLens}
      lensOptions={isPm ? LENSES : null}
      onLens={onLens}
      rows={rows}
      renderCount={(row) => <GapFigure gap={gapKey} value={row.count} lens={shownLens} keyValue={row.name} />}
      loading={loading}
      summary={
        <>
          <strong>{holders.holders}</strong> {holders.noun} {holders.verb} these{' '}
          <strong>{holders.total}</strong> {holders.villages} · most pending first
        </>
      }
      shareNote={`Share of gap = their pending ÷ ${fmt(gap.count)}`}
      check={check}
      empty={
        ready
          ? null
          : {
              title: 'Nothing to compare yet.',
              hint:
                'Once the Mojri tracker is imported, the villages approved in UEP but missing ' +
                `in Mojri are listed here by ${lensNoun(isPm ? lens : shownLens, 1)}.`,
            }
      }
    />
  )
}

export function Skeleton() {
  return (
    <div className="kpi-skeleton" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  )
}
