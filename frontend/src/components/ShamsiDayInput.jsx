import { toLatinDigits, toPersianDigits } from '../lib/persianDigits'

/**
 * One Shamsi day typed as ۱۴۰۵/۰۸/۲۸: Persian digits on screen, Latin digits
 * to the owner. No conversion here -- the server reads it (core/jalali
 * parse_day) and says plainly if the day does not exist.
 */
export default function ShamsiDayInput({ value, onChange, id, disabled, 'aria-label': ariaLabel }) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      dir="ltr"
      lang="fa"
      className="uep-shamsi-input"
      placeholder="۱۴۰۵/۰۸/۲۸"
      aria-label={ariaLabel}
      disabled={disabled}
      maxLength={10}
      value={toPersianDigits(value || '')}
      onChange={(e) => onChange(toLatinDigits(e.target.value).replace(/[^0-9/]/g, ''))}
    />
  )
}
