import { formatGregorian } from '../lib/dates'
import { shamsiLongLabel } from '../lib/shamsi'
import { Shamsi } from './DateText'

/**
 * An ICT or CRA letter's date as it is written on the letter (UEP-16 §3
 * Dates): Shamsi, Persian digits, Vazirmatn -- "۲۲ مهر ۱۴۰۵" -- with the
 * Gregorian day on hover. Every other date in UEP stays Gregorian.
 *
 * `shamsi` is the server's "1405/07/22"; `iso` the stored Gregorian day. The
 * server's calendar decided the day, so nothing is converted here.
 */
export default function LetterDate({ shamsi, iso, fallback = '—', className }) {
  const label = shamsiLongLabel(String(shamsi || '').replaceAll('/', '-'))
  if (!label) return fallback
  return (
    <Shamsi className={`uep-letter-date ${className || ''}`.trim()} title={formatGregorian(iso) ?? undefined}>
      {label}
    </Shamsi>
  )
}
