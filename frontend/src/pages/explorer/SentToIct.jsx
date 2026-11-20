import { Link } from 'react-router-dom'
import Icon from '../../components/Icon'
import { Shamsi, shamsiText } from '../../components/DateText'

/** One letter: "ICT HQ → provinces + CRA · ۹۱۲۷ · ۱۴۰۵/۰۹/۰۶", or "not recorded". */
function LetterLine({ label, letter }) {
  return (
    <li>
      <Icon name="document" size={16} />
      {label} ·{' '}
      {letter ? (
        <>
          {letter.no && <><Shamsi>{letter.no}</Shamsi> · </>}
          {letter.date && <Shamsi>{shamsiText(letter.date)}</Shamsi>}
        </>
      ) : <span className="ex-muted">not recorded</span>}
    </li>
  )
}

/**
 * The "Sent to ICT" step's detail (UEP-21 §5.9): the batch and its MTN
 * letter, the two optional onward letters, and whether Mojri has it. The
 * latest send only; earlier ones are counted.
 */
export default function SentToIct({ sends }) {
  if (!sends?.length) return null
  const s = sends[sends.length - 1]
  const earlier = sends.length - 1
  return (
    <ul className="ex-sent" aria-label="Sent to ICT">
      {s.outside_uep ? (
        <li><Icon name="send" size={16} />Sent outside UEP (found in Mojri <Shamsi>{shamsiText(s.sent_at)}</Shamsi>)</li>
      ) : (
        <>
          <li>
            <Icon name="send" size={16} />
            Batch <Link to={`/submissions/batches/${s.batch_number}`}>#{s.batch_number}</Link>
            {s.mtn?.no && <> · MTN letter <Shamsi>{s.mtn.no}</Shamsi></>}
            {s.mtn?.date && <> · <Shamsi>{shamsiText(s.mtn.date)}</Shamsi></>}
            {earlier > 0 && <span className="ex-muted"> · +{earlier} earlier</span>}
          </li>
          <LetterLine label="ICT HQ → provinces + CRA" letter={s.ict} />
          <LetterLine label="CRA HQ → regions" letter={s.cra} />
        </>
      )}
      <li>
        <Icon name="time" size={16} />
        {s.in_mojri_since ? <>In Mojri since <Shamsi>{shamsiText(s.in_mojri_since)}</Shamsi></> : 'Waiting for Mojri'}
      </li>
    </ul>
  )
}
