/** A card header's month (UEP-04a): the month and year in 600 ink, and
 * whatever follows it (" · in progress") in the header note's own style. One
 * element for every card that names its month, so they cannot drift apart. */
export default function MonthLabel({ label, suffix }) {
  if (!label) return null
  return (
    <>
      <span className="dt-month-label" data-testid="dt-month-label">
        {label}
      </span>
      {suffix}
    </>
  )
}
