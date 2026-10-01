import { SegmentedControl } from '../../components/ui'
import { LetterNumberDate, ScanAndSend } from './LetterFields'

const RESULTS = [
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

/** The caption beside a tech when the last round decided it. */
function carryCaption(carried) {
  if (!carried) return null
  const when = carried.round_no ? ` in round ${carried.round_no}` : ''
  return carried.result === 'approved'
    ? { text: `Approved${when}`, tone: 'success' }
    : { text: `Rejected${when}`, tone: 'danger' }
}

/**
 * One village, one side, being filed: a result per technology still to file
 * (Approved by default; Rejected asks for a reason), the techs already
 * approved carried over as they stand, then the letter and the button.
 */
export default function FilingForm({
  authority, requested, side, villageId, form, errors, actions, sendLabel, decides, onSend, onAttach, busy,
}) {
  const verdicts = form.verdicts[villageId] || {}
  const toFile = new Set(side.to_file)
  const idPrefix = `mw-${authority.toLowerCase()}`
  return (
    <div className="mw-form">
      <div className="mw-techs" role="group" aria-label={`${authority} result`}>
        {requested.map((tech) => {
          const caption = carryCaption(side.carry_over.find((c) => c.tech === tech))
          if (!toFile.has(tech)) {
            return (
              <div key={tech} className="mw-tech-row">
                <span className="mw-tech">{tech}</span>
                <span className="mw-tech-caption" data-tone="success">{caption?.text}</span>
                <span className="mw-pill" data-tone="success">Approved</span>
              </div>
            )
          }
          const verdict = verdicts[tech] || { result: 'approved', reason: '' }
          const reasonMissing = errors.reasons?.[tech]
          return (
            <div key={tech} className="mw-tech-block">
              <div className="mw-tech-row">
                <span className="mw-tech">{tech}</span>
                <span className="mw-tech-caption" data-tone={caption?.tone}>{caption?.text}</span>
                <SegmentedControl
                  className="mw-verdict"
                  label={tech}
                  options={RESULTS}
                  value={verdict.result}
                  onChange={(result) => actions.verdict(authority, villageId, tech, { result })}
                />
              </div>
              {verdict.result === 'rejected' && (
                <input
                  className={`mw-input${reasonMissing ? ' is-invalid' : ''}`}
                  aria-label={`${tech} reason`}
                  aria-invalid={reasonMissing ? true : undefined}
                  placeholder={reasonMissing ? 'Reason missing' : 'Reason'}
                  value={verdict.reason}
                  onChange={(e) => actions.verdict(authority, villageId, tech, { reason: e.target.value })}
                />
              )}
            </div>
          )
        })}
      </div>
      <LetterNumberDate
        idPrefix={idPrefix}
        letter={form.letter}
        errors={errors.fields}
        refiling={side.round_no != null}
        onChange={(patch) => actions.letter(authority, patch)}
      />
      <ScanAndSend
        scan={form.letter.scan}
        scanError={errors.fields.scan}
        onAttach={(file) => onAttach(authority, file)}
        onRemove={() => actions.letter(authority, { scan: null })}
        sendLabel={sendLabel}
        decides={decides}
        onSend={onSend}
        busy={busy}
      />
    </div>
  )
}
