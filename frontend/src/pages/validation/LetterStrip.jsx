import { Link } from 'react-router-dom'
import Icon from '../../components/Icon'
import LetterDate from '../../components/LetterDate'
import { explorerListPath } from '../../lib/explorerLinks'
import { formatNumber } from '../../lib/numbers'

// eslint-disable-next-line react-refresh/only-export-components -- shared with the viewer
export const KIND_TAG = { pdf: 'PDF', image: 'IMG', email: 'MAIL', file: 'FILE' }

/** ICT or CRA, bold in its own colour (UEP-16 §3). */
export function AuthorityBadge({ authority }) {
  return <span className={`vl-badge is-${authority.toLowerCase()}`}>{authority}</span>
}

/**
 * One letter of the open group: its authority, number, date and village
 * count; the kinds of evidence it carries; View and Download (all, as a zip,
 * when there is more than one file). Grey "No evidence" and amber "used on N
 * other villages" warn without blocking.
 */
export default function LetterStrip({ letter, open, onView, onDownload, busy }) {
  const files = letter.evidence || []
  const kinds = [...new Set(files.map((f) => f.kind))]
  const reused = letter.duplicate_use?.villages || 0
  return (
    <div className={`vl-strip ${open ? 'is-open' : ''}`.trim()} data-authority={letter.authority}>
      <AuthorityBadge authority={letter.authority} />
      <span className="vl-strip-number" dir="ltr">{letter.letter_number}</span>
      <LetterDate shamsi={letter.letter_date_shamsi} iso={letter.letter_date} />
      <span className="vl-strip-meta">{formatNumber(letter.villages)} {letter.villages === 1 ? 'village' : 'villages'}</span>
      {files.length > 0 ? (
        <>
          {kinds.map((k) => <span key={k} className="vl-kind">{KIND_TAG[k] || 'FILE'}</span>)}
          <span className="vl-strip-meta">{formatNumber(files.length)} {files.length === 1 ? 'file' : 'files'}</span>
        </>
      ) : (
        <span className="vl-chip is-grey">No evidence</span>
      )}
      {letter.without_evidence > 0 && files.length > 0 && (
        <span className="vl-chip is-grey">{formatNumber(letter.without_evidence)} without evidence</span>
      )}
      {reused > 0 && (
        <Link className="vl-chip is-amber" to={explorerListPath({ q: letter.letter_number })}>
          Letter number also used on {formatNumber(reused)} other {reused === 1 ? 'village' : 'villages'}
        </Link>
      )}
      <span className="vl-strip-end">
        <button type="button" className="vl-btn" onClick={() => onView(letter)} disabled={!files.length}>
          <Icon name="view" size={16} /> View
        </button>
        <button type="button" className="vl-btn" onClick={() => onDownload(letter)} disabled={!files.length || busy} aria-busy={busy || undefined}>
          <Icon name="download" size={16} /> {files.length > 1 ? 'Download all' : 'Download'}
        </button>
      </span>
    </div>
  )
}
