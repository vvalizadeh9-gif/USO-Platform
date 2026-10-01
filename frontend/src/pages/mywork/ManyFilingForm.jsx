import { X } from 'lucide-react'
import { statusOf } from './status'
import { LetterNumberDate, ScanAndSend } from './LetterFields'

/**
 * One letter for many villages: every village approved for the techs it
 * still has to file, except the rejections added row by row; one number, one
 * date, one scan. Ticked villages this side cannot take are listed as skipped.
 */
export default function ManyFilingForm({
  authority, fileable, skipped, form, errors, actions, sendLabel, decides, onSend, onAttach, busy,
}) {
  const used = new Set(form.rejections.map((r) => r.villageId))
  const pickable = fileable.filter((row) => !used.has(row.village_id))
  const byId = new Map(fileable.map((row) => [row.village_id, row]))
  return (
    <div className="mw-form">
      <div className="mw-many">
        <div className="mw-many-head">
          <span className="mw-pill" data-tone="success">{form.rejections.length ? 'Others approved' : 'All approved'}</span>
          {!form.picking && pickable.length > 0 && (
            <button type="button" className="btn btn-sm" onClick={() => actions.picking(authority, true)}>+ Rejection</button>
          )}
          {form.picking && pickable.map((row) => (
            <button
              key={row.village_id}
              type="button"
              className="btn btn-sm mw-pick text-farsi"
              onClick={() => {
                const techs = row.sides[authority].to_file
                actions.addRejection(authority, row.village_id, techs[techs.length - 1])
              }}
            >
              {row.village_name}
            </button>
          ))}
        </div>
        {form.rejections.map((rejection, index) => {
          const row = byId.get(rejection.villageId)
          if (!row) return null
          const err = errors.rejections?.[index] || {}
          return (
            <div key={rejection.villageId} className="mw-rejection">
              <span className="mw-rejection-name text-farsi" title={row.village_name}>{row.village_name}</span>
              {row.sides[authority].to_file.map((tech) => {
                const on = rejection.techs.includes(tech)
                return (
                  <button
                    key={tech}
                    type="button"
                    className={`mw-tech-toggle${err.techs ? ' is-invalid' : ''}`}
                    aria-pressed={on}
                    onClick={() => actions.rejection(authority, index, {
                      techs: on ? rejection.techs.filter((t) => t !== tech) : [...rejection.techs, tech],
                    })}
                  >
                    {on ? `${tech} rejected` : tech}
                  </button>
                )
              })}
              <input
                className={`mw-input mw-input-sm${err.reason ? ' is-invalid' : ''}`}
                aria-label={`${row.village_name} reason`}
                aria-invalid={err.reason ? true : undefined}
                placeholder={err.reason ? 'Reason missing' : 'Reason'}
                value={rejection.reason}
                onChange={(e) => actions.rejection(authority, index, { reason: e.target.value })}
              />
              <button type="button" className="mw-icon-btn" aria-label="Remove" onClick={() => actions.removeRejection(authority, index)}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )
        })}
        {skipped.length > 0 && (
          <span className="mw-skipped">
            Skipped: <span className="text-farsi-inline">
              {skipped.map((row) => `${row.village_name} (${statusOf(row.sides[authority].status).label.toLowerCase()})`).join('، ')}
            </span>
          </span>
        )}
      </div>
      <LetterNumberDate
        idPrefix={`mw-many-${authority.toLowerCase()}`}
        letter={form.letter}
        errors={errors.fields}
        refiling={false}
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
