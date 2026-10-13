import { useEffect, useId, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Modal } from '../../components/ui'

/**
 * Send a contractor's waiting plans back, with the comment they will read.
 *
 * The shared Modal (focus into the textarea, Tab kept inside, Escape closes,
 * focus back to the opener), rendered over the page with everything behind
 * it inert. The comment is required: the server refuses a return without one
 * and so does this. A failure is said inside the dialog, which stays open.
 */
export default function ReturnDialog({ name, busy, error, onSend, onCancel }) {
  const fieldId = useId()
  const titleId = useId()
  const [comment, setComment] = useState('')
  const [host] = useState(() => document.createElement('div'))

  const [behind] = useState(() => [])

  useLayoutEffect(() => {
    document.body.appendChild(host)
    // Layout cleanups run before any effect cleanup, so the page is live
    // again before the dialog's own cleanup puts focus back on the opener.
    return () => {
      behind.splice(0).forEach((el) => el.removeAttribute('inert'))
      host.remove()
    }
  }, [host, behind])

  // After the dialog has noted its opener and taken focus: inert the page.
  useEffect(() => {
    for (const el of document.body.children) {
      if (el !== host && !el.hasAttribute('inert')) {
        el.setAttribute('inert', '')
        behind.push(el)
      }
    }
  }, [host, behind])

  const ready = comment.trim().length > 0 && !busy
  return createPortal(
    <Modal
      open
      size="sm"
      onClose={busy ? () => {} : onCancel}
      labelledBy={titleId}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => onSend(comment.trim())}>
            {busy ? 'Sending…' : 'Send back'}
          </button>
        </>
      }
    >
      <h2 className="modal-title" id={titleId}>
        Send back to <bdi className="mp-fa">{name}</bdi>
      </h2>
      <label className="mp-field" htmlFor={fieldId}>What should they change?</label>
      <textarea
        id={fieldId}
        className="input mp-comment"
        rows={4}
        maxLength={1000}
        required
        aria-required="true"
        value={comment}
        disabled={busy}
        onChange={(e) => setComment(e.target.value)}
      />
      {error && <p className="mp-error" role="alert">{error}</p>}
    </Modal>,
    host,
  )
}
