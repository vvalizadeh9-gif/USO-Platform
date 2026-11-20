// One batch (UEP-21 §4.5) at /submissions/batches/:number.
// Draft: its villages, the MTN letter form, villages by CRA region.
// Sent: three equal letter cards (MTN always; ICT and CRA optional, never
// aging or warning), the Mojri tracker card and the villages with a dot each.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Icon from '../../components/Icon'
import PageFrame from '../../components/PageFrame'
import { ConfirmDialog } from '../../components/ui'
import { usePageCrumb } from '../../shell/crumbs'
import { detailMessage } from '../../lib/apiError'
import { formatNumber } from '../../lib/numbers'
import * as api from './api'
import { LetterDialog, LetterFields } from './dialogs'
import { mojriState, plural } from './format'
import { CardError, CardHead, Dot, MojriBar, ShamsiDay, SkeletonRows, Tag } from './parts'
import { useSummary } from './useSummary'
import '../../styles/work.css'
import '../../styles/submissions.css'

const LETTER_CARDS = [
  { kind: 'mtn', icon: 'send', tone: 'accent', title: 'MTN → ICT HQ', sub: 'Always recorded' },
  { kind: 'ict', icon: 'document', tone: 'ict', title: 'ICT HQ → ICT provinces + CRA', sub: 'One letter' },
  { kind: 'cra', icon: 'document', tone: 'cra', title: 'CRA HQ → CRA regions', sub: 'One letter' },
]

function LetterCard({ card, letter, canAct, onAdd }) {
  const recorded = letter.no || letter.date
  return (
    <article className="sb-card sb-letter" aria-label={card.title}>
      <header className="sb-letter-head" data-tone={card.tone}>
        <span className="sb-tile is-small" data-tone={card.tone} aria-hidden="true"><Icon name={card.icon} size={16} /></span>
        <span className="sb-letter-title">
          <b>{card.title}</b>
          <span className="sb-muted">{card.sub}</span>
        </span>
        {recorded ? <Tag tone="accent">Recorded</Tag> : <Tag>Optional</Tag>}
      </header>
      <dl className="sb-letter-fields">
        <div><dt>Letter no.</dt><dd>{letter.no || '—'}</dd></div>
        <div><dt>Letter date</dt><dd>{letter.date ? <ShamsiDay value={letter.date} /> : '—'}</dd></div>
      </dl>
      <div className="sb-letter-foot">
        {letter.file_id ? (
          <button type="button" className="sb-link" onClick={() => api.download(`/files/${letter.file_id}`, 'letter.pdf').catch(() => {})}>
            <Icon name="download" size={16} />Letter PDF
          </button>
        ) : !recorded && canAct && card.kind !== 'mtn' ? (
          <button type="button" className="uw-btn uw-btn-sm" onClick={onAdd}>Add letter</button>
        ) : <span className="sb-muted">No file</span>}
      </div>
    </article>
  )
}

function MojriCard({ batch, asOf }) {
  const m = batch.mojri || { in_mojri: 0, waiting: 0, follow_up: 0 }
  return (
    <article className="sb-card sb-mojri-card" aria-label="Mojri tracker">
      <div className="sb-mojri-top">
        <b>Mojri tracker</b>
        <span className="sb-muted">Mojri data as of <ShamsiDay value={asOf} /></span>
        <span className="sb-grow" />
        {batch.days_since_sent != null && (
          <span className="sb-muted">Days since sent {batch.days_since_sent} of {batch.follow_up_days}</span>
        )}
      </div>
      <MojriBar split={m} />
      <div className="sb-legend">
        <span><Dot tone="accent" />In Mojri {formatNumber(m.in_mojri)}</span>
        <span><Dot tone="pending" />Waiting {formatNumber(m.waiting)}</span>
        <span className={m.follow_up ? 'sb-late' : ''}><Dot tone="danger" />Follow up {formatNumber(m.follow_up)}</span>
      </div>
    </article>
  )
}

function VillageList({ batch, canRemove, onRemove }) {
  const sent = batch.status !== 'draft'
  return (
    <article className="sb-card sb-list" aria-label="Villages in this batch">
      <div className={`sb-thead ${sent ? 'sb-bv-sent' : 'sb-bv-draft'}`} role="row">
        <span>Site ID</span><span>Village code</span><span>Village</span><span>Province</span><span>CRA region</span>
        <span>{sent ? 'Mojri' : ''}</span>
      </div>
      <div className="sb-scroll">
        {batch.villages.map((v) => {
          const m = mojriState(v.mojri)
          return (
            <div key={v.item_id} className={`sb-row ${sent ? 'sb-bv-sent' : 'sb-bv-draft'}`} role="row">
              <span className="sb-strong">{v.site_code}</span>
              <span className="sb-num">{v.village_code}</span>
              <span className="sb-fa">{v.village_name}</span>
              <span className="sb-fa">{v.province || '—'}</span>
              <span>{v.cra_region || '—'}</span>
              {sent ? (
                <span className={`sb-status ${m?.tone === 'danger' ? 'sb-late' : ''}`.trim()}>{m && <><Dot tone={m.tone} />{m.label}</>}</span>
              ) : canRemove ? (
                <button type="button" className="sb-icon-btn" aria-label={`Remove ${v.village_code}`} onClick={() => onRemove(v.village_id)}>
                  <Icon name="close" size={16} />
                </button>
              ) : <span />}
            </div>
          )
        })}
      </div>
    </article>
  )
}

function SendCard({ number, onSent }) {
  const [value, setValue] = useState({ no: '', date: '', file: null })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function send() {
    setBusy(true)
    setError('')
    try {
      await api.markSent(number, value)
      onSent()
    } catch (err) {
      setError(detailMessage(err, 'The batch was not marked as sent.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="sb-card sb-side-card" aria-label="MTN to ICT HQ">
      <CardHead icon="send" title="MTN → ICT HQ" />
      <div className="sb-side-body">
        <LetterFields value={value} onChange={setValue} fileLabel="Attach MTN letter PDF" />
        {error && <p className="sb-error" role="alert">{error}</p>}
        <button type="button" className="uw-btn uw-btn-primary sb-wide" disabled={busy || !value.no || !value.date} onClick={send}>
          <Icon name="send" size={16} />Mark as sent
        </button>
      </div>
    </article>
  )
}

function RegionCard({ regions }) {
  const max = Math.max(1, ...regions.map((r) => r.count))
  return (
    <article className="sb-card sb-side-card" aria-label="By CRA region">
      <h2 className="sb-panel-title">By CRA region</h2>
      <ul className="sb-regions">
        {regions.map((r) => (
          <li key={r.name}>
            <span>{r.name}</span>
            <span className="sb-region-bar"><i style={{ width: `${(r.count / max) * 100}%` }} /></span>
            <span className="sb-num">{formatNumber(r.count)}</span>
          </li>
        ))}
      </ul>
    </article>
  )
}

export default function BatchPage() {
  const { number } = useParams()
  const navigate = useNavigate()
  const { summary } = useSummary()
  const [state, setState] = useState({ batch: null, error: '' })
  const [letter, setLetter] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [actionError, setActionError] = useState('')
  const crumbs = useMemo(() => [{ label: 'Submissions', to: '/submissions' }, { label: `Batch #${number}` }], [number])
  usePageCrumb(crumbs)

  const load = useCallback(() => {
    api.fetchBatch(number)
      .then((batch) => setState({ batch, error: '' }))
      .catch((err) => setState({ batch: null, error: detailMessage(err, 'The batch did not load.') }))
  }, [number])
  useEffect(load, [load])

  const b = state.batch
  const canAct = !!summary?.can_act
  const draft = b?.status === 'draft'

  async function remove(villageId) {
    setActionError('')
    try { await api.removeVillage(number, villageId); load() } catch (err) { setActionError(detailMessage(err, 'Not removed.')) }
  }
  async function cancel() {
    await api.cancelDraft(number)
    navigate('/submissions')
  }

  return (
    <PageFrame bar={null} className="sb-page">
      <div className="sb-head">
        <Link to="/submissions" className="sb-icon-btn" aria-label="Back to Submissions"><Icon name="arrow--left" size={16} /></Link>
        <h1>Batch #{number}</h1>
        {b && (draft ? <Tag>Draft</Tag> : <Tag tone="accent">Sent</Tag>)}
        {b && (
          <p className="sb-meta">
            {plural(b.villages_count, 'village')} · {plural(b.sites_count, 'site')} · {plural(b.regions.length, 'CRA region')}
            {b.imported && ' · Imported'}
          </p>
        )}
        <span className="sb-grow" />
        {actionError && <span className="sb-error">{actionError}</span>}
        {draft && canAct && <button type="button" className="uw-btn" onClick={() => setCancelling(true)}>Cancel draft</button>}
        {b && (
          <button type="button" className="uw-btn" onClick={() => api.download(`/batches/${number}/excel`, b.excel_filename).catch(() => {})}>
            <Icon name="download" size={16} />{b.excel_filename}
          </button>
        )}
      </div>
      {state.error && <CardError message={state.error} onRetry={load} />}
      {!b && !state.error && <SkeletonRows rows={10} />}
      {b && draft && (
        <div className="sb-draft">
          <VillageList batch={b} canRemove={canAct} onRemove={remove} />
          <div className="sb-side">
            {canAct && <SendCard number={number} onSent={load} />}
            <RegionCard regions={b.regions} />
          </div>
        </div>
      )}
      {b && !draft && (
        <>
          <div className="sb-letters-grid">
            {LETTER_CARDS.map((card) => (
              <LetterCard key={card.kind} card={card} letter={b.letters[card.kind]} canAct={canAct} onAdd={() => setLetter(card)} />
            ))}
          </div>
          <MojriCard batch={b} asOf={summary?.mojri.as_of} />
          <VillageList batch={b} />
        </>
      )}
      <LetterDialog
        open={!!letter}
        title={letter ? `Add letter · ${letter.title}` : ''}
        number={number}
        kind={letter?.kind}
        onClose={() => setLetter(null)}
        onSaved={load}
      />
      <ConfirmDialog
        open={cancelling}
        title={`Cancel draft #${number}?`}
        message="Its villages go back to Ready to submit."
        confirmLabel="Cancel draft"
        danger
        onConfirm={cancel}
        onCancel={() => setCancelling(false)}
      />
    </PageFrame>
  )
}
