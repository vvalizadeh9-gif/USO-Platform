// Filing's centre column (UEP-22 §3.1): the village, its two status boxes
// (the other authority's box switches the page to it), and the Update card.
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon'
import { siteRecordPath } from '../../lib/explorerLinks'
import { DigitInput } from '../mywork/LetterFields'
import {
  allowedChoices,
  basketFor,
  choiceTiles,
  commentLine,
  commentPlaceholder,
  CHOICE_REJECTED,
  CHOICE_WAITING,
  fieldErrors,
  missingFields,
  newRequestId,
} from './filingModel'
import { uploadScan } from './api'

function StatusBox({ box, onOpen }) {
  const line = commentLine(box.comment)
  const body = (
    <>
      <span className="fl-box-top">
        <span className={`fl-auth is-${box.authority.toLowerCase()}`}>{box.authority}</span>
        {onOpen && <span className="fl-box-open">open <Icon name="chevron--right" size={16} /></span>}
      </span>
      <span className="fl-box-status">
        <span className={`fl-dot is-${box.state}`} aria-hidden="true" />
        <span className="fl-box-label">{box.label}</span>
        {box.state !== 'approved' && (
          <span className={`fl-box-days${box.over_sla ? ' fl-danger' : ''}`}>{box.days_in_basket} d</span>
        )}
      </span>
      <span className="fl-box-sub">{box.sub}{box.in_validation && <span className="fl-tag-validation">In validation</span>}</span>
      {line && <span className={`fl-box-comment${line.stale ? ' fl-danger is-strong' : ''}`}>{line.text}</span>}
    </>
  )
  const cls = `fl-box is-${box.state}`
  return onOpen
    ? <button type="button" className={`${cls} is-link`} onClick={onOpen} aria-label={`Open ${box.authority}`}>{body}</button>
    : <div className={cls}>{body}</div>
}

function LetterRow({ letter, errors, onChange, onFile, scanBusy }) {
  const input = useRef(null)
  return (
    <div className="fl-letter">
      <label className="fl-field">
        <span className="fl-label">Letter number <span className="fl-req">*</span></span>
        <DigitInput value={letter.no} invalid={Boolean(errors.letter_no)} placeholder="۹۸۷۰" onChange={(no) => onChange({ no })} />
        {errors.letter_no && <span className="fl-field-error">Letter number is required</span>}
      </label>
      <label className="fl-field">
        <span className="fl-label">Letter date <span className="fl-req">*</span></span>
        <DigitInput value={letter.date} invalid={Boolean(errors.letter_date)} placeholder="۱۴۰۵/۰۸/۲۹" onChange={(date) => onChange({ date })} />
        {errors.letter_date && <span className="fl-field-error">{errors.letter_date === 'missing' ? 'Letter date is required' : errors.letter_date}</span>}
      </label>
      <div className="fl-field">
        <span className="fl-label">Letter <span className="fl-req">*</span></span>
        <button type="button" className={`fl-attach${errors.scan ? ' is-invalid' : ''}`} onClick={() => input.current?.click()} disabled={scanBusy}>
          <Icon name={letter.file ? 'document' : 'upload'} size={16} />
          <span className="fl-attach-name">{scanBusy ? 'Uploading…' : letter.file || 'Attach'}</span>
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".pdf,.jpg,.jpeg,.png,.webp,.eml,.msg"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) onFile(file)
          }}
        />
        {errors.scan && <span className="fl-field-error">{errors.scan === 'missing' ? 'Attach the letter' : errors.scan}</span>}
      </div>
    </div>
  )
}

const BLANK_LETTER = { no: '', date: '', file: null, scanId: null }

/** The Update card. `targets` are the village ids a save applies to. */
export const UpdateCard = forwardRef(function UpdateCard(
  { authority, state, can, categories, contractor, targets, title, onSaved, onSaving }, ref,
) {
  const allowed = allowedChoices(can, state)
  const [choice, setChoice] = useState(allowed[0] || CHOICE_WAITING)
  const [category, setCategory] = useState(null)
  const [letter, setLetter] = useState(BLANK_LETTER)
  const [comment, setComment] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const requestId = useRef(newRequestId())

  const choose = (key) => {
    if (!allowed.includes(key)) return
    setChoice(key)
    setErrors({})
  }

  const attach = async (file) => {
    setScanBusy(true)
    try {
      const scan = await uploadScan(file)
      setLetter((l) => ({ ...l, file: scan.filename, scanId: scan.scan_id }))
      setErrors((e) => ({ ...e, scan: undefined }))
    } catch (err) {
      setErrors((e) => ({ ...e, scan: err?.response?.data?.detail?.message || 'The file could not be attached' }))
    } finally {
      setScanBusy(false)
    }
  }

  const save = async () => {
    if (busy || !targets.length) return
    const missing = missingFields({
      choice, comment, category, letterNo: letter.no, letterDate: letter.date, scanId: letter.scanId,
    })
    if (Object.keys(missing).length) {
      setErrors(missing)
      return
    }
    setBusy(true)
    setMessage(null)
    onSaving?.(true)
    try {
      const out = await onSaved({
        village_ids: targets, authority, choice, comment: comment.trim(),
        category: choice === CHOICE_REJECTED ? category?.code : null,
        letter_no: choice === CHOICE_WAITING ? null : letter.no,
        letter_date: choice === CHOICE_WAITING ? null : letter.date,
        scan_ids: choice === CHOICE_WAITING || !letter.scanId ? [] : [letter.scanId],
        request_id: requestId.current,
      })
      if (out !== false) requestId.current = newRequestId()
    } catch (err) {
      const fields = fieldErrors(err)
      setErrors(fields)
      if (!Object.keys(fields).length || fields.village_ids || fields.choice) {
        setMessage(err?.response?.data?.detail?.message || 'The save failed. Try again.')
      }
    } finally {
      setBusy(false)
      onSaving?.(false)
    }
  }

  useImperativeHandle(ref, () => ({ choose, save }))

  if (!allowed.length) return null
  const tiles = choiceTiles(state)
  return (
    <form className="fl-card" onSubmit={(e) => { e.preventDefault(); save() }} aria-label={title}>
      <h2 className="fl-card-title">{title}</h2>
      <div className="fl-tiles" role="radiogroup" aria-label="Status">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={choice === t.key}
            disabled={!allowed.includes(t.key)}
            className={`fl-tile is-${t.tone}${choice === t.key ? ' is-on' : ''}`}
            onClick={() => choose(t.key)}
          >
            <kbd className="fl-tile-key">{t.hint}</kbd>{t.label}
          </button>
        ))}
      </div>
      {choice === CHOICE_REJECTED && (
        <div className="fl-cats">
          <span className="fl-label" id="fl-cat-label">Rejection category <span className="fl-req">*</span></span>
          <div className="fl-chips" role="radiogroup" aria-labelledby="fl-cat-label">
            {categories.map((c) => (
              <button
                key={c.code}
                type="button"
                role="radio"
                aria-checked={category?.code === c.code}
                className={`fl-chip${category?.code === c.code ? ' is-on' : ''}`}
                onClick={() => { setCategory(c); setErrors((e) => ({ ...e, category: undefined })) }}
              >
                {c.label}
              </button>
            ))}
          </div>
          {errors.category && <span className="fl-field-error">Pick a rejection category</span>}
          {category && <p className="fl-goes">Goes to <b>{basketFor(category, contractor)}</b> basket</p>}
          {!can.lands_directly && <p className="fl-note">A coordinator confirms the category in {authority} validation.</p>}
        </div>
      )}
      {choice !== CHOICE_WAITING && (
        <LetterRow letter={letter} errors={errors} scanBusy={scanBusy}
          onChange={(patch) => { setLetter((l) => ({ ...l, ...patch })); setErrors((e) => ({ ...e, letter_no: undefined, letter_date: undefined })) }}
          onFile={attach} />
      )}
      <label className="fl-field">
        <span className="fl-label">Comment <span className="fl-req">*</span></span>
        <textarea
          rows={2}
          className={`fl-textarea${errors.comment ? ' is-invalid' : ''}`}
          value={comment}
          placeholder={commentPlaceholder(choice, state, authority)}
          aria-invalid={Boolean(errors.comment) || undefined}
          onChange={(e) => { setComment(e.target.value); setErrors((x) => ({ ...x, comment: undefined })) }}
        />
        {errors.comment && <span className="fl-field-error">A comment is required on every save</span>}
      </label>
      {message && <p className="fl-field-error" role="alert">{message}</p>}
      <div className="fl-card-foot">
        {choice !== CHOICE_WAITING && !can.lands_directly && <span className="fl-note">Goes to {authority} validation</span>}
        <button type="submit" className="uw-btn uw-btn-primary fl-save" disabled={busy}>
          {busy && <span className="spinner fl-spinner" aria-hidden="true" />}
          Save · next village
        </button>
      </div>
    </form>
  )
})

export function VillageBlock({ village }) {
  return (
    <div className="fl-village">
      <span className="fl-village-meta">
        {village.code || village.id} · Site{' '}
        <Link to={siteRecordPath(village.work_item_id, village.id)}>{village.site_code}</Link>
        {village.province && <> · <bdi className="fa">{village.province}</bdi></>}
        {village.tech && <> · <bdi>{village.tech}</bdi></>}
      </span>
      <span className="fl-village-name fa">{village.name || village.code}</span>
    </div>
  )
}

export function StatusBoxes({ boxes, onOpenOther }) {
  return (
    <div className="fl-boxes">
      {boxes.map((box, i) => <StatusBox key={box.authority} box={box} onOpen={i === 1 ? onOpenOther : null} />)}
    </div>
  )
}

/** PM / coordinator: move a rejection to another category's basket, with a
 * reason (§4.4). Logged in the history. Also how a backfilled "Needs
 * category" rejection gets its category. */
export function ChangeBasket({ box, categories, onChange }) {
  const [open, setOpen] = useState(box.basket_key === 'needs_category')
  const [code, setCode] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    const category = categories.find((c) => c.code === code)
    if (!category || !reason.trim()) {
      setError(!category ? 'Pick a category' : 'Say why the basket changes')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onChange(box.case_id, { category_id: category.id, reason: reason.trim() })
      setReason('')
      setCode('')
    } catch (err) {
      setError(err?.response?.data?.detail?.message || 'The basket could not be changed')
    } finally {
      setBusy(false)
    }
  }
  if (!open) {
    return <button type="button" className="fl-link fl-change-open" onClick={() => setOpen(true)}>Change basket</button>
  }
  return (
    <form className="fl-change" onSubmit={submit} aria-label="Change basket">
      <label className="fl-field">
        <span className="fl-label">{box.basket_key === 'needs_category' ? 'Set the category' : 'Move to'} <span className="fl-req">*</span></span>
        <select className="mw-input" value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">Choose a category</option>
          {categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
      </label>
      <label className="fl-field fl-change-reason">
        <span className="fl-label">Reason <span className="fl-req">*</span></span>
        <input className="mw-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it moves" />
      </label>
      <button type="submit" className="uw-btn" disabled={busy}>Save basket</button>
      {error && <span className="fl-field-error" role="alert">{error}</span>}
    </form>
  )
}
