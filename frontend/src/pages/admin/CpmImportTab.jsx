import { AnimatePresence, motion } from 'framer-motion'
import { UploadCloud, FileSpreadsheet, Trash2, AlertTriangle, X } from 'lucide-react'
import { useRef, useState } from 'react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'

const CONFIRM_PHRASE = 'ERASE ALL CPM DATA'

export default function CpmImportTab() {
  const toast = useToast()
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [showWipeModal, setShowWipeModal] = useState(false)

  function pick(f) {
    if (f && /\.(xlsx|xls)$/i.test(f.name)) setFile(f)
    else toast.error('Invalid file', 'Please choose an .xlsx or .xls file.')
  }

  async function upload() {
    if (!file) return
    setBusy(true)
    setResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post('/admin/cpm/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setResult(data)
      toast.success('Import complete', `${data.new_count} new work items created.`)
    } catch (err) {
      toast.error('Import failed', err.response?.data?.detail || 'Please check the file and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div className="card card-pad">
        <h3 style={{ fontSize: 15, marginBottom: 6 }}>Upload monthly CPM file</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          Only master columns (A–AU) are refreshed. Execution history (AV onward) stays owned by the platform.
        </p>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files[0]) }}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `1.5px dashed ${dragOver ? 'var(--signal)' : 'var(--border)'}`,
            borderRadius: 'var(--radius)',
            padding: '38px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragOver ? 'var(--signal-glow)' : 'var(--surface-2)',
            transition: 'all 0.18s',
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            hidden
            onChange={(e) => pick(e.target.files[0])}
          />
          {file ? (
            <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
              <FileSpreadsheet size={22} style={{ color: 'var(--signal)' }} />
              <span style={{ fontWeight: 500 }}>{file.name}</span>
            </div>
          ) : (
            <>
              <UploadCloud size={30} style={{ color: 'var(--text-dim)', marginBottom: 8 }} />
              <div style={{ fontWeight: 500 }}>Drop your CPM Excel here</div>
              <div className="dim" style={{ fontSize: 12.5, marginTop: 3 }}>or click to browse</div>
            </>
          )}
        </div>

        <button
          className="btn btn-primary mt-16"
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={!file || busy}
          onClick={upload}
        >
          {busy ? <div className="spinner" /> : 'Run import'}
        </button>
      </div>

      {result && (
        <motion.div className="card card-pad" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
          <h3 style={{ fontSize: 15, marginBottom: 14 }}>Import summary</h3>
          <SummaryRow label="Total rows processed" value={result.total_rows} />
          <SummaryRow label="New work items" value={result.new_count} accent="var(--green)" />
          <SummaryRow label="New villages added" value={result.new_villages_count} accent="var(--green)" />
          <SummaryRow label="Unchanged work items" value={result.unchanged_count} />
          <SummaryRow label="Changes needing validation" value={result.changed_count} accent="var(--amber)" />
          {result.changed_count > 0 && (
            <div style={{ paddingLeft: 14, borderLeft: '2px solid var(--border-soft)', margin: '2px 0 2px 4px' }}>
              <SummaryRow label="— Village quantity changes" value={result.changed_village_qty} accent="var(--amber)" />
              <SummaryRow label="— Site type changes" value={result.changed_site_type} accent="var(--amber)" />
              <SummaryRow label="— Requested technology changes" value={result.changed_requested_tech} accent="var(--amber)" />
            </div>
          )}
          <SummaryRow label="Rows skipped (not هدف)" value={result.skipped_satellite} accent="var(--text-dim)" />
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Only villages classified exactly <b>هدف</b> are imported. All اقماری variants and the
            &ldquo;هدف (Verbally)&rdquo; / &ldquo;هدف (Removed Verbally)&rdquo; sub-flags are ignored.
          </p>
          {result.changed_count > 0 && (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
              Review flagged changes in the <b>Validate CPM</b> tab.
            </p>
          )}
        </motion.div>
      )}

      {/* Danger zone */}
      <div className="card card-pad" style={{ borderColor: 'var(--red)', borderWidth: 1.5 }}>
        <div className="row" style={{ gap: 8, color: 'var(--red)' }}>
          <AlertTriangle size={16} />
          <h3 style={{ fontSize: 14.5, color: 'var(--red)' }}>Danger zone</h3>
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8, marginBottom: 14 }}>
          Permanently erase all CPM-imported data (sites, work items, villages,
          acceptances, letters, import history). Users, roles, provinces, and
          contractors are kept. This cannot be undone.
        </p>
        <button
          className="btn btn-sm"
          style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
          onClick={() => setShowWipeModal(true)}
        >
          <Trash2 size={14} /> Erase all CPM data
        </button>
      </div>

      <AnimatePresence>
        {showWipeModal && (
          <WipeConfirmModal
            onClose={() => setShowWipeModal(false)}
            onWiped={() => {
              setShowWipeModal(false)
              setResult(null)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function SummaryRow({ label, value, accent }) {
  return (
    <div className="row between" style={{ padding: '9px 0', borderBottom: '1px solid var(--border-soft)' }}>
      <span className="muted" style={{ fontSize: 13 }}>{label}</span>
      <span className="tnum" style={{ fontWeight: 600, fontSize: 16, color: accent || 'var(--text)' }}>{value}</span>
    </div>
  )
}

function WipeConfirmModal({ onClose, onWiped }) {
  const toast = useToast()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const matches = typed.trim() === CONFIRM_PHRASE

  async function confirmWipe() {
    setBusy(true)
    try {
      const { data } = await api.post('/admin/cpm/wipe-data', { confirm: typed.trim() })
      toast.success('Data erased', `${data.total_deleted} records removed.`)
      onWiped()
    } catch (err) {
      toast.error('Erase failed', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,30,50,0.45)',
        display: 'grid', placeItems: 'center', zIndex: 200,
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 340, damping: 28 }}
        className="card card-pad"
        style={{ width: 440, borderColor: 'var(--red)', borderWidth: 1.5 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between">
          <div className="row" style={{ gap: 8, color: 'var(--red)' }}>
            <AlertTriangle size={18} />
            <h3 style={{ fontSize: 16, color: 'var(--red)' }}>Erase all CPM data?</h3>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose}><X size={15} /></button>
        </div>

        <p className="muted" style={{ fontSize: 13, marginTop: 12, lineHeight: 1.6 }}>
          This permanently deletes all sites, work items, villages, acceptances,
          letters, and import history. <b>Users, roles, provinces, and contractors
          are kept.</b> This action cannot be undone.
        </p>

        <div className="field mt-16">
          <label>Type <code style={{ color: 'var(--red)' }}>{CONFIRM_PHRASE}</code> to confirm</label>
          <input
            className="input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            autoFocus
          />
        </div>

        <div className="row mt-8" style={{ gap: 8 }}>
          <button
            className="btn"
            style={{
              background: matches ? 'var(--red)' : 'var(--surface-2)',
              color: matches ? '#fff' : 'var(--text-dim)',
              border: 'none',
            }}
            disabled={!matches || busy}
            onClick={confirmWipe}
          >
            {busy ? <div className="spinner" /> : <><Trash2 size={14} /> Erase permanently</>}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </motion.div>
    </motion.div>
  )
}
