import { useRef, useState } from 'react'
import api from '../../../api/client'
import Icon from '../../../components/Icon'
import { ConfirmDialog } from '../../../components/ui'
import { useToast } from '../../../context/ToastContext'
import { detailMessage } from '../../../lib/apiError'
import { describeBlobError, filenameFrom, saveBlob } from '../../../lib/download'
import ReviewPanel from './ReviewPanel'
import { STEPS, fmt } from './dataImportModel'

const MAX_BYTES = 20 * 1024 * 1024

/** Template · Upload · Review, then the result card. */
export default function ImportFlow({ onShowHistory }) {
  const toast = useToast()
  const [step, setStep] = useState('template')
  const [withCurrent, setWithCurrent] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [file, setFile] = useState(null)
  const [checking, setChecking] = useState(false)
  const [refusal, setRefusal] = useState(null)
  const [batch, setBatch] = useState(null)
  const [applied, setApplied] = useState(null)
  const [undoOpen, setUndoOpen] = useState(false)
  const [undoing, setUndoing] = useState(false)

  async function downloadTemplate() {
    setDownloading(true)
    try {
      const r = await api.get('/data-import/template', { params: { current: withCurrent ? 1 : 0 }, responseType: 'blob' })
      saveBlob(r.data, filenameFrom(r.headers, 'UEP_import_template.xlsx'))
    } catch (err) {
      toast.error('Template not downloaded', await describeBlobError(err))
    } finally {
      setDownloading(false)
    }
  }

  async function check() {
    if (!file) return
    setChecking(true)
    setRefusal(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post('/data-import/batches', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setBatch(data)
      setStep('review')
    } catch (err) {
      setRefusal(detailMessage(err, 'The file could not be checked.'))
    } finally {
      setChecking(false)
    }
  }

  function reset() {
    setBatch(null)
    setFile(null)
    setApplied(null)
    setRefusal(null)
    setStep('upload')
  }

  async function undo() {
    setUndoing(true)
    try {
      const { data } = await api.post(`/data-import/batches/${applied.id}/undo`)
      const kept = data.result?.kept_rows || 0
      toast.success(`Batch #${data.number} undone`,
        kept ? `${fmt(kept)} rows were changed after this import and were kept` : undefined)
      setUndoOpen(false)
      setApplied({ ...applied, ...data })
    } catch (err) {
      toast.error('Undo failed', detailMessage(err, 'Nothing was changed.'))
    } finally {
      setUndoing(false)
    }
  }

  const stepIndex = STEPS.findIndex((s) => s.key === (applied ? 'review' : step))

  return (
    <div className="di-flow">
      <ol className="di-steps" aria-label="Import steps">
        {STEPS.map((s, i) => {
          const state = i === stepIndex ? 'current' : i < stepIndex ? 'done' : 'todo'
          const reachable = !applied && !checking && (s.key === 'template' || s.key === 'upload' || (s.key === 'review' && batch))
          return (
            <li key={s.key} className={`di-step is-${state}`}>
              <button type="button" disabled={!reachable} aria-current={state === 'current' ? 'step' : undefined}
                onClick={() => setStep(s.key)}>
                <span className="di-step-no tnum">{state === 'done' ? <Icon name="checkmark" size={16} /> : i + 1}</span>
                {s.label}
              </button>
            </li>
          )
        })}
      </ol>

      <div className="di-stage" key={applied ? 'done' : step}>
        {applied && (
          <section className="di-card di-result" aria-live="polite">
            <Icon name={applied.status === 'undone' ? 'undo' : 'checkmark--outline'} size={20} />
            <div className="di-result-text">
              <h2>Batch #{applied.number} {applied.status === 'undone' ? 'undone' : 'applied'}</h2>
              <p className="tnum">{fmt(applied.counts?.applied_changes ?? applied.result?.applied_changes)} changes</p>
            </div>
            <div className="di-result-actions">
              {applied.status === 'applied' && (
                <button type="button" className="btn" onClick={() => setUndoOpen(true)}>
                  <Icon name="undo" size={16} />Undo batch
                </button>
              )}
              <button type="button" className="btn" onClick={onShowHistory}>View in History</button>
              <button type="button" className="btn btn-primary" onClick={reset}>New import</button>
            </div>
          </section>
        )}

        {!applied && step === 'template' && (
          <section className="di-card di-template">
            <h2>Template</h2>
            <label className="di-toggle" title="Pre-fill the drive test, ICT and CRA columns with what UEP holds today">
              <input type="checkbox" role="switch" checked={withCurrent}
                onChange={(e) => setWithCurrent(e.target.checked)} />
              <span className="di-toggle-track" aria-hidden="true" />
              Fill in current UEP values
            </label>
            <div className="di-card-actions">
              <button type="button" className="btn btn-primary" onClick={downloadTemplate} disabled={downloading}>
                <Icon name="download" size={16} />{downloading ? 'Preparing…' : 'Download template'}
              </button>
              <button type="button" className="btn" onClick={() => setStep('upload')}>
                Upload <Icon name="arrow--right" size={16} />
              </button>
            </div>
          </section>
        )}

        {!applied && step === 'upload' && (
          <UploadCard file={file} onFile={(f) => { setFile(f); setRefusal(null) }} checking={checking}
            refusal={refusal} onCheck={check} />
        )}

        {!applied && step === 'review' && batch && (
          <ReviewPanel
            batch={batch}
            onBatch={setBatch}
            onCancel={reset}
            onApplied={(data) => {
              setApplied(data)
              toast.success(`Batch #${data.number} applied`, `${fmt(data.result?.applied_changes)} changes`)
            }}
            onExpired={reset}
          />
        )}
      </div>

      <ConfirmDialog
        open={undoOpen}
        title={`Undo batch #${applied?.number}?`}
        message={`Reverses ${fmt(applied?.counts?.records)} records of ${fmt(applied?.counts?.sites)} sites and ${fmt(applied?.counts?.villages)} villages. Rows changed after this import are kept.`}
        confirmLabel="Undo batch"
        danger
        busy={undoing}
        onConfirm={undo}
        onCancel={() => setUndoOpen(false)}
      />
    </div>
  )
}

function UploadCard({ file, onFile, checking, refusal, onCheck }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)
  const [local, setLocal] = useState(null)

  function pick(f) {
    if (!f) return
    if (!/\.xlsx$/i.test(f.name)) { setLocal('Only .xlsx files are accepted'); return }
    if (f.size > MAX_BYTES) { setLocal('The file is larger than 20 MB'); return }
    setLocal(null)
    onFile(f)
  }

  const message = local || refusal
  return (
    <section className="di-card di-upload">
      <h2>Upload</h2>
      <div
        className={`di-drop ${over ? 'is-over' : ''}`.trim()}
        role="button"
        tabIndex={0}
        aria-label="Choose the filled template"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]) }}
      >
        <input ref={inputRef} type="file" accept=".xlsx" hidden data-testid="di-file"
          onChange={(e) => pick(e.target.files[0])} />
        {file ? (
          <span className="di-file"><Icon name="document" size={20} />{file.name}
            <span className="di-file-size tnum">{fmt(Math.ceil(file.size / 1024))} KB</span></span>
        ) : (
          <span className="di-drop-empty"><Icon name="cloud--upload" size={20} />Drop the filled template or click to choose</span>
        )}
      </div>
      {checking && (
        <div className="di-progress" role="progressbar" aria-label="Checking the file" aria-busy="true">
          <span className="di-progress-bar" />
          <span className="di-progress-text">Checking every row against UEP…</span>
        </div>
      )}
      {message && (
        <p className="di-refused" role="alert"><Icon name="warning--alt" size={16} />{message}</p>
      )}
      <div className="di-card-actions">
        <button type="button" className="btn btn-primary" disabled={!file || checking} onClick={onCheck}>
          {checking ? 'Checking…' : 'Check file'}
        </button>
      </div>
    </section>
  )
}
