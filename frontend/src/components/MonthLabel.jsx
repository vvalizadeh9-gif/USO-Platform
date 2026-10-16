import { toPersianDigits } from '../lib/persianDigits'
import { Shamsi } from './DateText'

/** A card header's month (UEP-04a): the month and year in 600 ink, and
 * whatever follows it (" · in progress") in the header note's own style. One
 * element for every card that names its month, so they cannot drift apart. */
export default function MonthLabel({ label, suffix }) {
  if (!label) return null
  // A Shamsi month, wholly in Persian digits and isolated right-to-left, so
  // "مهر ۱۴۰۵" never comes out reversed inside an English line (UEP-13 §3.7).
  return (
    <>
      <Shamsi className="dt-month-label" data-testid="dt-month-label">
        {toPersianDigits(label)}
      </Shamsi>
      {suffix}
    </>
  )
}
