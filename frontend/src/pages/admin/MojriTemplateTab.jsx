import { useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import api from '../../api/client'
import { describeBlobError, filenameFrom, saveBlob } from '../../lib/download'

/**
 * Admin → Mojri Template.
 *
 * One button, and it is a **read**: it builds a spreadsheet from villages we
 * have already approved and writes nothing. That is why it is Admin's at all —
 * Admin has no write access to operational data, and the import that follows
 * this file back in is PM's alone (see ARCHITECTURE.md §6, and
 * app/api/mojri.py, which refuses Admin both import endpoints).
 *
 * The text explains what the file is for, because the step in the middle
 * happens outside this platform: somebody fills the blank technology columns
 * in from Mojri's own file, by hand, and hands it to the PM.
 */
export default function MojriTemplateTab() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function download() {
    setBusy(true)
    setError('')
    try {
      const response = await api.get('/mojri/template.xlsx', { responseType: 'blob' })
      saveBlob(response.data, filenameFrom(response.headers, 'mojri_template.xlsx'))
    } catch (err) {
      setError(await describeBlobError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div className="card card-pad">
        <h3 style={{ fontSize: 15, marginBottom: 6 }}>Mojri tracker template</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>
          One row per village ICT or CRA has already approved, with the
          technology columns blank. Fill them in from Mojri&apos;s own file —
          that step is manual and happens outside this platform — then hand the
          file to the PM, who imports it.
        </p>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
          <strong>site_id</strong> and <strong>site_type</strong> are there to
          help you match rows against Mojri&apos;s file, which is organised by
          site. The importer reads <strong>village_id</strong> and nothing else:
          one site routinely serves several villages, and registration is per
          village. Cells marked <strong>n/a</strong> are technologies that
          village never requested — leave them alone, they are ignored.
        </p>

        {error && <p className="kpi-error" style={{ marginBottom: 12 }}>{error}</p>}

        <button
          type="button"
          className="btn btn-primary"
          onClick={download}
          disabled={busy}
        >
          <FileSpreadsheet size={15} aria-hidden="true" />
          {busy ? 'Building…' : 'Download template'}
        </button>
      </div>
    </div>
  )
}
