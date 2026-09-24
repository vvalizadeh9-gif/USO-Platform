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
 * rows whose village_id matched nothing, listed one by one rather than
 * counted;
 *
 * villages that were in the tracker last import and are absent from this file
 * — flagged as a discrepancy and left exactly as they are. A row filtered out
 * of a spreadsheet is not evidence that a registration was withdrawn;
 *
 * villages that need a look — a cell nobody could read as either a yes or a
 * blank. The importer never guesses, so this number is a work list, not a
 * failure.
 */
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
        eyebrow="Reconciliation"
        title="Mojri tracker"
        subtitle="Is ICT HQ's own tracker up to date with the villages we have already approved?"
      />

      {error && <div className="kpi-error">{error}</div>}

      <section className="card card-pad kpi-card">
        <h3 className="kpi-card-title">1 · The template</h3>
        <p className="kpi-note">
          One row per village we have approved, technology columns blank. Fill
          it in from Mojri&apos;s file by hand — that step is deliberately
          outside this platform — then bring it back here.
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

function Preview({ data, onConfirm, busy }) {
  return (
    <section className="card card-pad kpi-card" data-testid="mojri-preview">
      <h3 className="kpi-card-title">3 · What confirming would do</h3>

      <p className="gap-example">
        {fmtCount(data.total_rows)} row{data.total_rows === 1 ? '' : 's'} read,{' '}
        {fmtCount(data.matched)} matched a village
        {data.unmatched > 0 && `, ${fmtCount(data.unmatched)} did not`}.
      </p>

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
            {data.exceptions
              .slice(0, 8)
              .map((row) => `row ${row.row} (${row.reason})`)
              .join('; ')}
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
          disabled={busy}
        >
          {busy ? 'Applying…' : 'Confirm and import'}
        </button>
      </div>
    </section>
  )
}

function Done({ data }) {
  return (
    <section className="card card-pad kpi-card" data-testid="mojri-done">
      <h3 className="kpi-card-title">
        <CheckCircle2 size={16} aria-hidden="true" /> Imported
      </h3>
      <EmptyState
        title={`${fmtCount(data.matched)} village${data.matched === 1 ? '' : 's'} updated`}
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
