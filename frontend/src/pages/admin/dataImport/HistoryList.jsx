import { useCallback, useEffect, useState } from 'react'
import api from '../../../api/client'
import Icon from '../../../components/Icon'
import { ConfirmDialog } from '../../../components/ui'
import { useToast } from '../../../context/ToastContext'
import { detailMessage } from '../../../lib/apiError'
import { describeBlobError, filenameFrom, saveBlob } from '../../../lib/download'
import SummaryBar from './SummaryBar'
import { STATUS_LABEL, fmt, shortDate } from './dataImportModel'

/** Every batch: number, file, who, when, status, counts and its files. */
export default function HistoryList({ canEdit }) {
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [undoing, setUndoing] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const { data } = await api.get('/data-import/batches')
      setRows(data)
    } catch (err) {
      setError(detailMessage(err, 'Check your connection and try again.'))
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function download(batch, path, fallback) {
    try {
      const r = await api.get(`/data-import/batches/${batch.id}/${path}`, { responseType: 'blob' })
      saveBlob(r.data, filenameFrom(r.headers, fallback))
    } catch (err) {
      toast.error('Not downloaded', await describeBlobError(err))
    }
  }

  async function undo() {
    setBusy(true)
    try {
      const { data } = await api.post(`/data-import/batches/${undoing.id}/undo`)
      const kept = data.result?.kept_rows || 0
      toast.success(`Batch #${data.number} undone`,
        kept ? `${fmt(kept)} rows were changed after this import and were kept` : undefined)
      setUndoing(null)
      load()
    } catch (err) {
      toast.error('Undo failed', detailMessage(err, 'Nothing was changed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="di-card di-history">
      {error && (
        <div className="di-refused" role="alert">
          <Icon name="warning--alt" size={16} />History could not be loaded. {error}
          <button type="button" className="btn btn-sm" onClick={load}>Try again</button>
        </div>
      )}
      {!error && !rows && <div className="di-skel" aria-busy="true" />}
      {rows && rows.length === 0 && <p className="di-empty">No imports yet</p>}
      {rows && rows.length > 0 && (
        <div className="di-table-scroll">
          <table className="di-table">
            <thead>
              <tr>
                <th scope="col" className="di-col-row">#</th>
                <th scope="col">File</th>
                <th scope="col">Uploaded by</th>
                <th scope="col">Date</th>
                <th scope="col">Status</th>
                <th scope="col" className="di-col-bar">Counts</th>
                <th scope="col" className="di-col-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="tnum di-col-row">{b.number}</td>
                  <td className="di-filename" title={b.filename}>{b.filename}</td>
                  <td>{b.uploaded_by || '—'}</td>
                  <td className="tnum">{shortDate(b.applied_at || b.uploaded_at)}</td>
                  <td><span className={`di-chip is-${b.status}`}>{STATUS_LABEL[b.status] || b.status}</span></td>
                  <td className="di-col-bar"><SummaryBar counts={b.counts} mini /></td>
                  <td className="di-col-actions">
                    <button type="button" className="btn btn-sm btn-icon" title="Download file" aria-label={`Download file of batch ${b.number}`}
                      onClick={() => download(b, 'file', b.filename)}>
                      <Icon name="download" size={16} />
                    </button>
                    <button type="button" className="btn btn-sm btn-icon" title="Change log" aria-label={`Change log of batch ${b.number}`}
                      onClick={() => download(b, 'changes.xlsx', `UEP_import_${b.number}_changes.xlsx`)}>
                      <Icon name="document" size={16} />
                    </button>
                    {canEdit && b.status === 'applied' && (
                      <button type="button" className="btn btn-sm btn-icon" title="Undo batch" aria-label={`Undo batch ${b.number}`}
                        onClick={() => setUndoing(b)}>
                        <Icon name="undo" size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(undoing)}
        title={`Undo batch #${undoing?.number}?`}
        message={`Reverses ${fmt(undoing?.counts?.records)} records of ${fmt(undoing?.counts?.sites)} sites and ${fmt(undoing?.counts?.villages)} villages. Rows changed after this import are kept.`}
        confirmLabel="Undo batch"
        danger
        busy={busy}
        onConfirm={undo}
        onCancel={() => setUndoing(null)}
      />
    </section>
  )
}
