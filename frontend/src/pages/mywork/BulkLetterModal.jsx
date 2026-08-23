import { motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import api from '../../api/client'
import { EvidenceBox, LetterFields, VerdictRows, useUploadLimits } from './SubmissionForm'
import { errorText } from './status'

const AUTHORITIES = ['ICT', 'CRA']

/**
 * One letter, many villages.
 *
 * An ICT letter routinely covers a hundred villages at once, and filing them
 * one at a time is the same form a hundred times. The server does it as a
 * single transaction: if any village fails its rules, none are filed and the
 * response names the ones that failed — a half-filed batch would leave the
 * contractor with no way to tell which villages went in.
 *
 * Only villages requesting exactly the same technologies can share a letter,
 * so the list is grouped by that and one group is chosen at a time. The server
 * enforces it regardless; this only stops the mistake being made.
 */
export default function BulkLetterModal({ onClose, onDone }) {
  const limits = useUploadLimits()
  const [authority, setAuthority] = useState('ICT')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState(null)
  const [chosen, setChosen] = useState(() => new Set())
  const [signature, setSignature] = useState(null)

  const [number, setNumber] = useState('')
  const [date, setDate] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 250)
    return () => clearTimeout(id)
  }, [search])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  // Only villages that can still take this authority are offered.
  useEffect(() => {
    setRows(null)
    api
      .get('/acceptance/villages', {
        params: { search: query || undefined, limit: 200, sort: 'site_code' },
      })
      .then((r) => setRows(r.data.rows.filter((row) => row.can_submit.includes(authority))))
      .catch(() => setRows([]))
  }, [query, authority])

  useEffect(() => {
    setChosen(new Set())
    setSignature(null)
  }, [authority])

  const claimsFor = useMemo(() => (signature ? signature.split('+') : []), [signature])
  const [claims, setClaims] = useState([])
  useEffect(() => {
    setClaims(
      claimsFor.map((t) => ({
        technology: t,
        claimed_status: 'Approved',
        comment: '',
      })),
    )
  }, [signature]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (technology, patch) =>
    setClaims((cur) =>
      cur.map((c) => (c.technology === technology ? { ...c, ...patch } : c)),
    )

  function toggle(row) {
    const rowSignature = row.requested_technologies.join('+')
    setChosen((cur) => {
      const next = new Set(cur)
      if (next.has(row.village_id)) next.delete(row.village_id)
      else next.add(row.village_id)
      if (next.size === 0) setSignature(null)
      else if (!signature) setSignature(rowSignature)
      return next
    })
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const form = new FormData()
      form.append(
        'payload',
        JSON.stringify({
          village_ids: [...chosen],
          authority,
          letter_number: number,
          letter_date_shamsi: date || null,
          technologies: claims.map((c) => ({
            technology: c.technology,
            claimed_status: c.claimed_status,
            comment: c.comment || null,
          })),
        }),
      )
      if (file) form.append('file', file)
      const { data } = await api.post('/acceptance/submissions/bulk', form)
      onDone(`Letter ${data.letter_number} submitted for ${data.count} villages`)
    } catch (err) {
      const detail = err?.response?.data?.detail
      if (detail?.failures) {
        const named = detail.failures
          .slice(0, 4)
          .map((f) => `${f.village_name || f.village_id}: ${f.reason}`)
          .join(' · ')
        setError(
          `${detail.message}. ${named}${
            detail.failures.length > 4 ? ` · and ${detail.failures.length - 4} more` : ''
          }`,
        )
      } else {
        setError(errorText(err, 'Could not send the letter. Check the form and try again.'))
      }
    } finally {
      setBusy(false)
    }
  }

  const offered = (rows || []).filter(
    (row) => !signature || row.requested_technologies.join('+') === signature,
  )
  const ready = chosen.size > 0 && number.trim() && claims.length > 0

  return (
    <>
      <div className="scrim" onClick={() => !busy && onClose()} />
      <div className="modal-wrap">
        <motion.form
          className="modal"
          onSubmit={submit}
          role="dialog"
          aria-label="One letter, many villages"
          initial={{ opacity: 0, y: 10, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.18 }}
        >
          <header>
            <div>
              <h3 style={{ fontSize: 16 }}>One letter, many villages</h3>
              <div className="dim" style={{ fontSize: 12 }}>
                {chosen.size} selected
                {signature ? ` · ${signature.replace(/\+/g, ' · ')}` : ''}
              </div>
            </div>
            <span className="spacer" />
            <div className="queue-filters" style={{ margin: 0, width: 'auto' }}>
              {AUTHORITIES.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="queue-filter"
                  style={{ flex: '0 0 auto', padding: '5px 14px' }}
                  aria-pressed={authority === name}
                  onClick={() => setAuthority(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>
              <X size={15} />
            </button>
          </header>

          <div
            className="body"
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            {error && <div className="form-banner form-banner-error">{error}</div>}

            <div>
              <div className="queue-search">
                <Search size={14} className="dim" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Village or site code"
                  aria-label="Search villages"
                />
              </div>

              <div style={{ maxHeight: 210, overflowY: 'auto', marginTop: 8 }}>
                {rows === null && (
                  <div className="dim" style={{ padding: 12, fontSize: 13 }}>
                    Loading…
                  </div>
                )}
                {rows !== null && offered.length === 0 && (
                  <div className="dim" style={{ padding: 12, fontSize: 13 }}>
                    No village can take an {authority} letter right now.
                  </div>
                )}
                {offered.map((row) => (
                  <label key={row.village_id} className="check-row">
                    <input
                      type="checkbox"
                      checked={chosen.has(row.village_id)}
                      onChange={() => toggle(row)}
                      disabled={busy}
                    />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                        {row.village_name || row.village_code}
                      </span>
                      <span className="dim" style={{ fontSize: 11.5, marginLeft: 8 }}>
                        {row.site_code} · {row.requested_technologies.join(' ')}
                      </span>
                    </span>
                  </label>
                ))}
                {signature && rows !== null && rows.length !== offered.length && (
                  <div className="dim" style={{ padding: '8px 12px', fontSize: 11.5 }}>
                    {rows.length - offered.length} village
                    {rows.length - offered.length === 1 ? '' : 's'} hidden: a letter can
                    only cover villages requesting the same technologies.
                  </div>
                )}
              </div>
            </div>

            <LetterFields
              number={number}
              onNumber={setNumber}
              date={date}
              onDate={setDate}
              disabled={busy}
            />

            {claims.length > 0 && (
              <div>
                <div className="caps" style={{ marginBottom: 4 }}>
                  What {authority} decided — applied to every selected village
                </div>
                <VerdictRows claims={claims} onChange={set} authority={authority} />
              </div>
            )}

            <EvidenceBox file={file} onFile={setFile} limits={limits} disabled={busy} />
          </div>

          <div className="form-foot">
            <span className="dim" style={{ fontSize: 12 }}>
              {busy
                ? `Submitting ${chosen.size} of ${chosen.size}…`
                : 'All of them go in together, or none do.'}
            </span>
            <span className="spacer" />
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy || !ready}>
              {busy ? 'Submitting…' : `Submit ${chosen.size || ''} for validation`}
            </button>
          </div>
        </motion.form>
      </div>
    </>
  )
}
