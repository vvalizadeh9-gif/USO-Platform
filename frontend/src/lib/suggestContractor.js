// Which contractor the assign panel suggests, and the order of its cards
// (UEP-06 §4.2). Kept apart from the component so the rule is tested alone.

/** How many of `provinces` a contractor's 90-day coverage includes. */
function covered(contractor, provinces) {
  const theirs = new Set((contractor.provinces || []).map((p) => p.province))
  return [...provinces].filter((p) => theirs.has(p)).length
}

/**
 * The contractor whose coverage includes the most provinces of the selected
 * sites; a tie goes to the lower open load (then the name, so the answer is
 * stable). None when nobody covers any of them.
 * @param {{ contractor_id: number, name: string, open: number, provinces: {province: string}[] }[]} contractors
 * @param {Iterable<string>} provinces of the selected sites
 */
export function suggestContractor(contractors, provinces) {
  const wanted = new Set([...provinces].filter(Boolean))
  if (wanted.size === 0) return null
  let best = null
  let bestScore = 0
  for (const c of contractors) {
    const score = covered(c, wanted)
    if (score === 0) continue
    const better =
      score > bestScore ||
      (score === bestScore && (c.open < best.open || (c.open === best.open && c.name < best.name)))
    if (better) {
      best = c
      bestScore = score
    }
  }
  return best
}

/** The selected provinces this contractor covers, for "Suggested: works in …". */
export function coveredProvinces(contractor, provinces) {
  const theirs = new Set((contractor?.provinces || []).map((p) => p.province))
  return [...new Set(provinces)].filter((p) => p && theirs.has(p))
}

/** Lowest open load first; the suggested contractor, when there is one, first of all. */
export function orderContractors(contractors, suggested) {
  const sorted = [...contractors].sort((a, b) => a.open - b.open || a.name.localeCompare(b.name))
  if (!suggested) return sorted
  return [suggested, ...sorted.filter((c) => c.contractor_id !== suggested.contractor_id)]
}
