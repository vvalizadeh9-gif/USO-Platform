import { useLayoutEffect, useRef } from 'react'
import { Calendar, Check, FileText, Send, Upload, X } from 'lucide-react'
import { toLatinDigits, toPersianDigits } from '../../lib/persianDigits'

/**
 * An input that shows Persian digits and hands its owner Latin ones. Typing,
 * pasting or an Arabic-Indic keyboard all store the same value, and the caret
 * stays where the person put it (each digit swaps for one of equal length).
 */
export function DigitInput({ value, onChange, invalid, placeholder, ...rest }) {
  const ref = useRef(null)
  const caret = useRef(null)
  useLayoutEffect(() => {
    if (caret.current != null && ref.current && document.activeElement === ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current)
    }
  })
  return (
    <input
      {...rest}
      ref={ref}
      dir="ltr"
      className={`mw-input mw-digits${invalid ? ' is-invalid' : ''}`}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      value={toPersianDigits(value)}
      onChange={(e) => {
        caret.current = e.target.selectionStart
        onChange(toLatinDigits(e.target.value))
      }}
    />
  )
}

/** A field with its label drawn on the border. */
function Outlined({ label, invalid, children }) {
  return (
    <label className={`mw-outlined${invalid ? ' is-invalid' : ''}`}>
      <span className="mw-outlined-label">{label}</span>
      {children}
    </label>
  )
}

/** Letter number and date, side by side. Errors read inside the field. */
export function LetterNumberDate({ letter, errors, onChange, refiling, idPrefix }) {
  const numberError = errors.number
  const dateError = errors.date
  return (
    <div className="mw-letter-grid">
      <Outlined label={refiling ? 'New letter number' : 'Letter number'} invalid={Boolean(numberError)}>
        <DigitInput
          id={`${idPrefix}-number`}
          value={letter.number}
          invalid={Boolean(numberError)}
          placeholder={numberError ? 'Missing' : ''}
          onChange={(number) => onChange({ number })}
        />
      </Outlined>
      <Outlined label="Letter date" invalid={Boolean(dateError)}>
        <DigitInput
          id={`${idPrefix}-date`}
          value={letter.date}
          invalid={Boolean(dateError)}
          placeholder={dateError === 'missing' ? 'Missing' : ''}
          onChange={(date) => onChange({ date })}
        />
        <Calendar className="mw-date-icon" size={18} aria-hidden="true" />
      </Outlined>
    </div>
  )
}

/** The scan attachment and the side's button, on one row. */
export function ScanAndSend({ scan, scanError, onAttach, onRemove, sendLabel, decides, onSend, busy }) {
  const input = useRef(null)
  const SendIcon = decides ? Check : Send
  return (
    <div className="mw-send-row">
      {scan?.scanId || scan?.uploading ? (
        <span className="mw-scan-chip">
          <FileText size={16} aria-hidden="true" />
          <span className="mw-scan-name">{scan.uploading ? 'Uploading…' : scan.filename}</span>
          <button type="button" className="mw-icon-btn" aria-label="Remove scan" onClick={onRemove} disabled={scan.uploading}>
            <X size={16} aria-hidden="true" />
          </button>
        </span>
      ) : (
        <>
          <button
            type="button"
            className={`mw-drop${scanError ? ' is-invalid' : ''}`}
            onClick={() => input.current?.click()}
            title={scan?.error || undefined}
          >
            <Upload size={16} aria-hidden="true" />
            {scanError ? 'Scan missing' : 'Attach scan'}
          </button>
          <input
            ref={input}
            type="file"
            hidden
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) onAttach(file)
            }}
          />
        </>
      )}
      <button type="button" className="btn btn-primary mw-send" onClick={onSend} disabled={busy}>
        <SendIcon size={16} aria-hidden="true" />
        {sendLabel}
      </button>
    </div>
  )
}
