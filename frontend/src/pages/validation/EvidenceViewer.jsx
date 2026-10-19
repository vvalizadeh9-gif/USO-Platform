import { useEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon'
import LetterDate from '../../components/LetterDate'
import { detailMessage } from '../../lib/apiError'
import { formatBytes } from '../../lib/numbers'
import { attachmentUrl, downloadAttachment, downloadEvidence, evidenceUrl, fetchEmail } from './api'
import { AuthorityBadge, KIND_TAG } from './LetterStrip'

const ZOOM = { min: 50, max: 300, step: 25 }
const clampZoom = (z) => Math.min(ZOOM.max, Math.max(ZOOM.min, z))

/** A PDF in the browser's own viewer, framed from this site only (nginx
 * evidence-frame.conf). Page and zoom go to it as the open parameters. */
function PdfView({ src, page, zoom, title }) {
  return <iframe className="ev-pdf" title={title} src={`${src}#page=${page}&zoom=${zoom}`} />
}

/** An image with zoom; drag (or scroll) to pan. */
function ImageView({ src, zoom, alt }) {
  const box = useRef(null)
  const drag = useRef(null)
  const onPointerDown = (e) => {
    drag.current = { x: e.clientX, y: e.clientY, left: box.current.scrollLeft, top: box.current.scrollTop }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (!drag.current) return
    box.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x)
    box.current.scrollTop = drag.current.top - (e.clientY - drag.current.y)
  }
  const stop = () => { drag.current = null }
  return (
    <div
      ref={box}
      className="ev-image"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <img src={src} alt={alt} style={{ width: `${zoom}%` }} draggable={false} />
    </div>
  )
}

/** The email as plain text: headers, body, attachments. Its HTML never
 * reaches the page -- the server sends text only, drawn here as text. */
function EmailView({ file, letter }) {
  const [mail, setMail] = useState(null)
  const [error, setError] = useState(null)
  const [opened, setOpened] = useState(null)
  useEffect(() => {
    let live = true
    setMail(null)
    setError(null)
    setOpened(null)
    fetchEmail(file.id)
      .then((data) => { if (live) setMail(data) })
      .catch((err) => { if (live) setError(detailMessage(err, 'This email could not be read')) })
    return () => { live = false }
  }, [file.id])

  if (error) {
    return (
      <div className="ev-state" role="alert">
        <Icon name="warning--alt" size={20} />
        <span>{error}</span>
        <button type="button" className="vl-btn" onClick={() => downloadEvidence(file).catch(() => {})}>
          <Icon name="download" size={16} /> Download
        </button>
      </div>
    )
  }
  if (!mail) return <div className="ev-state" aria-busy="true">Loading the email…</div>
  if (opened) {
    const src = attachmentUrl(file.id, opened.index)
    return (
      <div className="ev-attachment">
        <button type="button" className="vl-btn" onClick={() => setOpened(null)}>
          <Icon name="chevron--left" size={16} /> Back to the email
        </button>
        {opened.kind === 'pdf'
          ? <PdfView src={src} page={1} zoom={100} title={opened.filename} />
          : <ImageView src={src} zoom={100} alt={opened.filename} />}
      </div>
    )
  }
  const head = [['From', mail.from], ['To', mail.to], ['Cc', mail.cc], ['Subject', mail.subject]]
  return (
    <div className="ev-email">
      <dl className="ev-email-head">
        {head.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd dir="auto">{v}</dd></div>
        ))}
        <div>
          <dt>Date</dt>
          <dd>{mail.date ? new Date(mail.date).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd>
        </div>
        <div>
          <dt>Letter</dt>
          <dd><LetterDate shamsi={letter.letter_date_shamsi} iso={letter.letter_date} /></dd>
        </div>
      </dl>
      <pre className="ev-email-body" dir="auto">{mail.text_body || 'No text in this email.'}</pre>
      {mail.attachments.length > 0 && (
        <ul className="ev-email-files" aria-label="Attachments">
          {mail.attachments.map((a) => (
            <li key={a.index}>
              <span className="vl-kind">{KIND_TAG[a.kind] || 'FILE'}</span>
              <span className="ev-file-name" dir="auto">{a.filename}</span>
              <span className="ev-file-size">{formatBytes(a.size_bytes)}</span>
              {(a.kind === 'pdf' || a.kind === 'image') && (
                <button type="button" className="vl-btn" onClick={() => setOpened(a)}>
                  <Icon name="view" size={16} /> Open
                </button>
              )}
              <button type="button" className="vl-btn" onClick={() => downloadAttachment(file.id, a).catch(() => {})}>
                <Icon name="download" size={16} /> Download
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The evidence of one letter, beside the table (UEP-16 §3): a toolbar
 * (authority, letter, zoom and pages where they apply, Download, Close), a
 * tab per file when there are several, and the file itself.
 */
export default function EvidenceViewer({ letter, startAt = 0, onClose }) {
  const files = letter.evidence || []
  const [index, setIndex] = useState(Math.min(startAt, Math.max(files.length - 1, 0)))
  const [zoom, setZoom] = useState(100)
  const [page, setPage] = useState(1)
  const file = files[index]
  const closeRef = useRef(null)

  useEffect(() => { setZoom(100); setPage(1) }, [index, letter.letter_number])
  useEffect(() => { closeRef.current?.focus() }, [letter.letter_number])

  if (!file) return null
  const zoomable = file.kind === 'pdf' || file.kind === 'image'
  const title = `${letter.authority} ${letter.letter_number} · ${file.filename}`

  return (
    <section className="ev-viewer" aria-label={`Evidence for ${letter.authority} letter ${letter.letter_number}`}>
      <header className="ev-toolbar">
        <AuthorityBadge authority={letter.authority} />
        <span className="ev-number" dir="ltr">{letter.letter_number}</span>
        <LetterDate shamsi={letter.letter_date_shamsi} iso={letter.letter_date} />
        <span className="ev-tools">
          {zoomable && (
            <>
              <button type="button" className="ev-icon-btn" aria-label="Zoom out" onClick={() => setZoom((z) => clampZoom(z - ZOOM.step))} disabled={zoom <= ZOOM.min}>
                <Icon name="zoom--out" size={16} />
              </button>
              <span className="ev-zoom tnum" aria-live="polite">{zoom}%</span>
              <button type="button" className="ev-icon-btn" aria-label="Zoom in" onClick={() => setZoom((z) => clampZoom(z + ZOOM.step))} disabled={zoom >= ZOOM.max}>
                <Icon name="zoom--in" size={16} />
              </button>
            </>
          )}
          {file.kind === 'pdf' && (
            <>
              <button type="button" className="ev-icon-btn" aria-label="Previous page" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                <Icon name="chevron--left" size={16} />
              </button>
              <span className="ev-page tnum">Page {page}{file.pages ? ` of ${file.pages}` : ''}</span>
              <button type="button" className="ev-icon-btn" aria-label="Next page" onClick={() => setPage((p) => (file.pages ? Math.min(file.pages, p + 1) : p + 1))}>
                <Icon name="chevron--right" size={16} />
              </button>
            </>
          )}
          <button type="button" className="vl-btn" onClick={() => downloadEvidence(file).catch(() => {})}>
            <Icon name="download" size={16} /> Download
          </button>
          <button type="button" className="ev-icon-btn" aria-label="Close the viewer" onClick={onClose} ref={closeRef}>
            <Icon name="close" size={16} />
          </button>
        </span>
      </header>
      {files.length > 1 && (
        <div className="ev-tabs" role="tablist" aria-label="Files on this letter">
          {files.map((f, i) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              className="ev-tab"
              onClick={() => setIndex(i)}
            >
              <span className="vl-kind">{KIND_TAG[f.kind] || 'FILE'}</span>
              <span className="ev-file-name" dir="auto">{f.filename}</span>
              <span className="ev-file-size">{formatBytes(f.size_bytes)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="ev-body" key={file.id}>
        {file.kind === 'pdf' && <PdfView src={evidenceUrl(file.id)} page={page} zoom={zoom} title={title} />}
        {file.kind === 'image' && <ImageView src={evidenceUrl(file.id)} zoom={zoom} alt={title} />}
        {file.kind === 'email' && <EmailView file={file} letter={letter} />}
        {file.kind === 'file' && (
          <div className="ev-state">
            <Icon name="document" size={20} />
            <span>This file cannot be shown here.</span>
            <button type="button" className="vl-btn" onClick={() => downloadEvidence(file).catch(() => {})}>
              <Icon name="download" size={16} /> Download
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
