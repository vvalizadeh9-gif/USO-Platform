// The dot rule's numbers and words (components/ItemDots.jsx draws it).

/** Up to this many items get one dot each; more get one proportional bar. */
export const DOTS_MAX = 30

/** The dots in words, for the row that holds them: "9 items: 6 on time, ...". */
export function dotsLabel({ onTime = 0, dueSoon = 0, late = 0 }) {
  const total = onTime + dueSoon + late
  return `${total} ${total === 1 ? 'item' : 'items'}: ${onTime} on time, ${dueSoon} due soon, ${late} late`
}
