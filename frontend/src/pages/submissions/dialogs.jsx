// Submissions' small dialogs: change owner, add a letter, mark raised, import.
import { useCallback, useEffect, useId, useState } from 'react'
import { Modal } from '../../components/ui'
import ShamsiDayInput from '../../components/ShamsiDayInput'
import { detailMessage } from '../../lib/apiError'
import { formatNumber } from '../../lib/numbers'
import * as api from './api'
import { shamsiInput } from './format'
import { SkeletonRows } from './parts'

function Footer({ busy, onCancel, label, disabled, onConfirm }) {
  return (
    <>
      <button type="button" className="uw-btn" onClick={onCancel}>Cancel</button>
      <button type="button" className="uw-btn uw-btn-primary" disabled={busy || disabled} onClick={onConfirm}>
        {busy ? 'Saving…' : label}
      </button>
    </>
  )
}

function useSubmit(onDone) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      onDone()
    } catch (err) {
      setError(detailMessage(err, err.message))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

/** One coordinator per row, as a radio: name, initials, the CRA regions they
 * hold, and "Current owner". A list rather than a dropdown, so nothing opens
 * inside the dialog and nothing can be clipped by it. */
function OwnerOption({ person, checked, onPick }) {
  const initials = person.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <label className={`sb-owner ${checked ? 'is-checked' : ''}`.trim()}>
      <input type="radio" name="sb-owner" value={person.id} checked={checked} onChange={() => onPick(String(person.id))} />
      <span className="sb-owner-avatar" aria-hidden="true">{initials}</span>
      <span className="sb-owner-text">
        <span className="sb-owner-name">{person.name}</span>
        <span className="sb-owner-meta">{person.regions?.length ? person.regions.join(' · ') : 'No CRA region assigned'}</span>
      </span>
      {person.is_owner && <span className="sb-tag" data-tone="accent">Current owner</span>}
    </label>
  )
}

export function OwnerDialog({ open, current, onClose, onSaved }) {
  const [state, setState] = useState({ rows: null, error: '' })
  const [choice, setChoice] = useState('')
  const { busy, error, run } = useSubmit(() => { onSaved(); onClose() })
  const load = useCallback(() => {
    setState({ rows: null, error: '' })
    api.fetchOwnerCandidates()
      .then((d) => setState({ rows: d.rows, error: '' }))
      .catch((err) => setState({ rows: [], error: detailMessage(err, 'The coordinators did not load.') }))
  }, [])
  useEffect(() => {
    if (!open) return
    setChoice(current ? String(current.id) : '')
    load()
  }, [open, current, load])
  const unchanged = !choice || (current && String(current.id) === choice)
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Change owner"
      footer={<Footer busy={busy} onCancel={onClose} label="Make owner" disabled={unchanged} onConfirm={() => run(() => api.setOwner(Number(choice)))} />}
    >
      <p className="sb-owner-lead">The owner prepares and sends the batches to ICT HQ. The PM can always act too.</p>
      <div className="sb-owner-list" role="radiogroup" aria-label="Coordinators">
        {!state.rows && <SkeletonRows rows={3} />}
        {state.error && (
          <p className="sb-error" role="alert">
            {state.error} <button type="button" className="sb-link" onClick={load}>Retry</button>
          </p>
        )}
        {state.rows?.length === 0 && !state.error && (
          <p className="sb-owner-empty">
            No active coordinator accounts. An Admin adds one in <b>Admin › Users &amp; roles</b> with the role <b>Coordinator</b>.
          </p>
        )}
        {state.rows?.map((p) => (
          <OwnerOption key={p.id} person={p} checked={choice === String(p.id)} onPick={setChoice} />
        ))}
      </div>
      {error && <p className="sb-error" role="alert">{error}</p>}
    </Modal>
  )
}

/** Letter no., Shamsi date and an optional PDF or image. */
export function LetterFields({ value, onChange, fileLabel = 'Letter PDF' }) {
  const id = useId()
  return (
    <div className="sb-fields">
      <label className="sb-field" htmlFor={`${id}-no`}>
        <span>Letter no.</span>
        <input id={`${id}-no`} className="input" value={value.no} maxLength={120} onChange={(e) => onChange({ ...value, no: e.target.value })} />
      </label>
      <label className="sb-field" htmlFor={`${id}-date`}>
        <span>Letter date</span>
        <ShamsiDayInput id={`${id}-date`} value={value.date} onChange={(date) => onChange({ ...value, date })} />
      </label>
      <label className="sb-field" htmlFor={`${id}-file`}>
        <span>{fileLabel}</span>
        <input id={`${id}-file`} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => onChange({ ...value, file: e.target.files?.[0] || null })} />
      </label>
    </div>
  )
}

export function LetterDialog({ open, title, number, kind, onClose, onSaved }) {
  const [value, setValue] = useState({ no: '', date: '', file: null })
  const { busy, error, run } = useSubmit(() => { onSaved(); onClose() })
  useEffect(() => { if (open) setValue({ no: '', date: '', file: null }) }, [open])
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      footer={<Footer busy={busy} onCancel={onClose} label="Add letter" disabled={!value.date} onConfirm={() => run(() => api.addLetter(number, kind, value))} />}
    >
      <LetterFields value={value} onChange={setValue} />
      {error && <p className="sb-error" role="alert">{error}</p>}
    </Modal>
  )
}

export function RaiseDialog({ open, count, onClose, onConfirm }) {
  const [note, setNote] = useState('')
  const { busy, error, run } = useSubmit(onClose)
  useEffect(() => { if (open) setNote('') }, [open])
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={`Mark ${formatNumber(count)} raised with ICT`}
      footer={<Footer busy={busy} onCancel={onClose} label="Mark raised" onConfirm={() => run(() => onConfirm(note))} />}
    >
      <label className="sb-field">
        <span>Note (optional)</span>
        <textarea className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="sb-error" role="alert">{error}</p>}
    </Modal>
  )
}

/** Past batches #1–#39: preview each file, confirm each with its letter date. */
export function ImportDialog({ open, onClose, onSaved }) {
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setItems([]); setError('') } }, [open])

  async function pick(files) {
    setBusy(true)
    setError('')
    const next = []
    for (const file of files) {
      try {
        const p = await api.previewImport(file)
        next.push({ file, preview: p, date: shamsiInput(p.workbook_date), no: '', state: 'ready' })
      } catch (err) {
        next.push({ file, error: detailMessage(err, 'Could not read this file.'), state: 'error' })
      }
    }
    setItems(next)
    setBusy(false)
  }

  async function confirm() {
    setBusy(true)
    setError('')
    const next = [...items]
    for (const [i, it] of next.entries()) {
      if (it.state !== 'ready' || it.preview.already_imported) continue
      try {
        await api.commitImport(it.file, { digest: it.preview.digest, date: it.date, no: it.no })
        next[i] = { ...it, state: 'done' }
      } catch (err) {
        next[i] = { ...it, state: 'error', error: detailMessage(err, 'Could not import this file.') }
      }
    }
    setItems(next)
    setBusy(false)
    if (next.every((it) => it.state !== 'error')) { onSaved(); onClose() }
  }

  const ready = items.filter((it) => it.state === 'ready' && !it.preview.already_imported)
  const update = (i, patch) => setItems((all) => all.map((it, j) => (j === i ? { ...it, ...patch } : it)))
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Import past batches"
      footer={<Footer busy={busy} onCancel={onClose} label={`Confirm ${ready.length || ''}`.trim()} disabled={!ready.length || ready.some((it) => !it.date)} onConfirm={confirm} />}
    >
      <label className="sb-field">
        <span>Batch files (.xlsx, 18-column format)</span>
        <input type="file" accept=".xlsx" multiple onChange={(e) => pick([...(e.target.files || [])])} />
      </label>
      <ul className="sb-import-list">
        {items.map((it, i) => (
          <li key={`${it.file.name}-${i}`} className="sb-import-item">
            <b>{it.file.name}</b>
            {it.state === 'error' && <span className="sb-error">{it.error}</span>}
            {it.preview && (
              <>
                <span className="sb-muted">
                  {it.preview.number ? `Batch #${it.preview.number}` : 'No batch number found'}
                  {' · '}{formatNumber(it.preview.matched)} matched · {formatNumber(it.preview.unmatched)} unmatched
                  {' · '}{formatNumber(it.preview.skipped)} skipped
                  {it.preview.already_recorded ? ` · ${formatNumber(it.preview.already_recorded)} already recorded` : ''}
                </span>
                {it.preview.already_imported && <span className="sb-muted">Already imported</span>}
                {it.preview.number_taken && !it.preview.already_imported && <span className="sb-error">This batch number is already recorded</span>}
                {it.state === 'ready' && !it.preview.already_imported && (
                  <label className="sb-field">
                    <span>MTN letter date</span>
                    <ShamsiDayInput value={it.date} onChange={(date) => update(i, { date })} />
                  </label>
                )}
                {it.state === 'done' && <span className="sb-muted">Imported</span>}
                {it.preview.unmatched_rows?.length > 0 && (
                  <details>
                    <summary>Unmatched rows</summary>
                    <ul className="sb-unmatched">
                      {it.preview.unmatched_rows.map((r) => (
                        <li key={r.row}>Row {r.row}: {r.site_code} · {r.site_type} · {r.village_code}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="sb-error" role="alert">{error}</p>}
    </Modal>
  )
}
