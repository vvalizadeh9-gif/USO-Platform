import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, UploadCloud } from 'lucide-react'
import api from '../../api/client'
import { EmptyState, PageHead } from '../../components/ui'
import { describeBlobError, filenameFrom, saveBlob } from '../../lib/download'
import { fmtCount } from '../reports/kpiTheme'

/**
 * Mojri tracker reconciliation — PM only.
 *
 * Upload → preview → confirm, and **nothing is written before confirm**. The
 * preview is a separate request that opens the file, reads every cell and
 * returns what would happen; the Confirm button does not exist until that
 * result is on the screen, and it sends the same file back with the digest the
 * preview returned, so what is written is provably what was read.
 *
 * Three things the preview refuses to hide, because each would otherwise be a
 * silent loss:
 *
 * rows that matched no UEP village, listed one by one by the codes that were
 * typed (site_code / site_type / village_code) rather than counted — and, when
 * fewer than MATCH_FLOOR of the rows matched, a red banner at the top, because
 * a file that mostly matches nothing is the wrong file, not a noisy one;
 *
 * villages that were in the tracker last import and are absent from this file
 * — flagged as a discrepancy and left exactly as they are. A row filtered out
 * of a spreadsheet is not evidence that a registration was withdrawn;
 *
 * villages that need a look — a cell nobody could read as either a yes or a
 * blank. The importer never guesses, so this number is a work list, not a
 * failure.
 */
/** Below this share of matched rows the preview says, in red, that the file
 *  is probably wrong. A correct file matches nearly every row. */
const MATCH_FLOOR = 0.9

export default function MojriImport() {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [done, setDone] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  function pick(chosen) {
    setError('')
    setPreview(null)
    setDone(null)
    if (!chosen) return
    if (!/\.xlsx$/i.test(chosen.name)) {
      setError('Choose the .xlsx template, filled in.')
      return
    }
    setFile(chosen)
  }

  async function downloadTemplate() {
    setBusy('template')
    setError('')
    try {
      const response = await api.get('/mojri/template.xlsx', { responseType: 'blob' })
      saveBlob(response.data, filenameFrom(response.headers, 'mojri_template.xlsx'))
    } catch (err) {
      setError(await describeBlobError(err))
    } finally {
      setBusy('')
    }
  }

  async function send(path, extra) {
    const form = new FormData()
    form.append('file', file)
    Object.entries(extra ?? {}).forEach(([key, value]) => form.append(key, value))
    const { data } = await api.post(`/mojri/import/${path}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  }

  async function runPreview() {
    if (!file) return
    setBusy('preview')
    setError('')
    setDone(null)
    try {
      setPreview(await send('preview'))
    } catch (err) {
      setError(err.response?.data?.detail || 'That file could not be read.')
    } finally {
      setBusy('')
    }
  }

  async function confirm() {
    if (!file || !preview) return
    setBusy('commit')
    setError('')
    try {
      setDone(await send('commit', { digest: preview.digest }))
      setPreview(null)
    } catch (err) {
      setError(err.response?.data?.detail || 'The import could not be applied.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="kpi gap">
      <PageHead
        eyebrow="Month-end"
        title="Mojri Tracker"
        subtitle="Is ICT HQ's own tracker up to date with the villages we have already approved?"
      />

      {error && <div className="kpi-error">{error}</div>}

      <section className="card card-pad kpi-card">
        <h3 className="kpi-card-title">1 · The template</h3>
        <p className="kpi-note">
          One row per village we have approved, technology columns blank. Each
          row is matched on its <strong>site_code</strong>,{' '}
          <strong>site_type</strong> and <strong>village_code</strong> — the
          codes in your own tracker — so keep those three as they are. Fill in
          the technology columns from Mojri&apos;s file by hand (a yes, or the
          technology&apos;s own name: 2G in the 2G column) — that step is
          deliberately outside this platform — then bring it back here.
        </p>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={downloadTemplate}
          disabled={busy !== ''}
        >
          <FileSpreadsheet size={15} aria-hidden="true" />
          {busy === 'template' ? 'Building…' : 'Download template'}
        </button>
      </section>

      <section className="card card-pad kpi-card">
        <h3 className="kpi-card-title">2 · The filled file</h3>
        <p className="kpi-note">
          Nothing is written until you confirm. This step only reads the file
          and tells you what it would do.
        </p>

        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="kpi-hidden"
            aria-label="Filled template"
            onChange={(event) => pick(event.target.files?.[0])}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => inputRef.current?.click()}
            disabled={busy !== ''}
          >
            <UploadCloud size={15} aria-hidden="true" />
            {file ? file.name : 'Choose file'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={runPreview}
            disabled={!file || busy !== ''}
          >
            {busy === 'preview' ? 'Reading…' : 'Preview'}
          </button>
        </div>
      </section>

      {preview && (
        <Preview data={preview} onConfirm={confirm} busy={busy === 'commit'} />
      )}

      {done && <Done data={done} />}
    </div>
  )
}

/** Rows matched, whatever the server calls it: `matched_rows`, or the older
 *  `matched` it is kept alongside. */
function matchedRows(data) {
  return data.matched_rows ?? data.matched ?? 0
}

function unmatchedLabel(row) {
  const key = [row.site_code, row.site_type, row.village_code]
    .map((part) => part || '—')
    .join(' / ')
  return `row ${row.row} ${key} (${row.reason})`
}

function Preview({ data, onConfirm, busy }) {
  const matched = matchedRows(data)
  const share = data.total_rows > 0 ? matched / data.total_rows : 0
  const nothingMatched = matched === 0

  return (
    <section className="card card-pad kpi-card" data-testid="mojri-preview">
      <h3 className="kpi-card-title">3 · What confirming would do</h3>

      <p className="gap-example" data-testid="mojri-match-line">
        <strong>
          Matched {fmtCount(matched)} of {fmtCount(data.total_rows)} row
          {data.total_rows === 1 ? '' : 's'}
        </strong>
        {data.villages_matched != null && data.villages_matched !== matched &&
          ` — ${fmtCount(data.villages_matched)} villages`}
        {data.unmatched > 0 && `, ${fmtCount(data.unmatched)} not imported`}.
      </p>

      {share < MATCH_FLOOR && (
        <div className="kpi-banner danger" role="alert" style={{ marginBottom: 14 }}>
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            {nothingMatched
              ? 'None of these rows match a UEP village, so this file cannot be imported. '
              : `Only ${Math.floor(share * 100)}% of the rows match a UEP village. `}
            Check the site_code, site_type and village_code columns — they
            must hold the codes from the template.
          </span>
        </div>
      )}

      <div className="kpi-table-wrap">
        <table className="kpi-table gap-table">
          <thead>
            <tr>
              <th scope="col">Authority</th>
              <th scope="col">In tracker</th>
              <th scope="col">Needs a look</th>
              <th scope="col">Not in tracker</th>
              <th scope="col">Moving this run</th>
            </tr>
          </thead>
          <tbody>
            {['ict', 'cra'].map((authority) => {
              const row = data.authorities[authority]
              return (
                <tr key={authority}>
                  <th scope="row">{authority.toUpperCase()}</th>
                  <td className="kpi-plain">{fmtCount(row.in_tracker)}</td>
                  <td className="kpi-plain">{fmtCount(row.needs_look)}</td>
                  <td className="kpi-plain">{fmtCount(row.not_in_tracker)}</td>
                  <td className="kpi-plain">
                    +{fmtCount(row.moving_to_in_tracker)} in tracker
                    <em>+{fmtCount(row.moving_to_needs_look)} needs a look</em>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {data.exceptions.length > 0 && (
        <div className="kpi-banner warn" style={{ marginTop: 14 }}>
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            {fmtCount(data.unmatched)} row
            {data.unmatched === 1 ? '' : 's'} will not be imported:{' '}
            {data.exceptions.slice(0, 8).map(unmatchedLabel).join('; ')}
            {data.exceptions_truncated > 0 &&
              ` — and ${fmtCount(data.exceptions_truncated)} more`}
            .
          </span>
        </div>
      )}

      {data.disappeared_count > 0 && (
        <div className="kpi-banner warn" style={{ marginTop: 14 }}>
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            {fmtCount(data.disappeared_count)} village
            {data.disappeared_count === 1 ? '' : 's'} in the tracker last import
            {data.disappeared_count === 1 ? ' is' : ' are'} absent from this
            file:{' '}
            {data.disappeared
              .slice(0, 8)
              .map((row) => `${row.village} (${row.authorities.join(', ')})`)
              .join('; ')}
            . They are left exactly as they are — a row missing from a
            spreadsheet is not a registration being withdrawn.
          </span>
        </div>
      )}

      <div className="row" style={{ gap: 10, marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onConfirm}
          disabled={busy || nothingMatched}
        >
          {busy ? 'Applying…' : 'Confirm and import'}
        </button>
      </div>
    </section>
  )
}

function Done({ data }) {
  const updated = data.villages_matched ?? matchedRows(data)
  return (
    <section className="card card-pad kpi-card" data-testid="mojri-done">
      <h3 className="kpi-card-title">
        <CheckCircle2 size={16} aria-hidden="true" /> Imported
      </h3>
      <EmptyState
        title={`${fmtCount(updated)} village${updated === 1 ? '' : 's'} updated`}
        hint={
          `ICT: ${fmtCount(data.authorities.ict.in_tracker)} in tracker, ` +
          `${fmtCount(data.authorities.ict.needs_look)} need a look. ` +
          `CRA: ${fmtCount(data.authorities.cra.in_tracker)} in tracker, ` +
          `${fmtCount(data.authorities.cra.needs_look)} need a look.`
        }
      />
    </section>
  )
}
