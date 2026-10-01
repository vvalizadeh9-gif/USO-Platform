// How one round reads in a history line and the card's notes.
import { toPersianDigits } from '../../lib/persianDigits'

const joinTechs = (techs) => (techs.length > 1
  ? `${techs.slice(0, -1).join(', ')} and ${techs[techs.length - 1]}`
  : techs[0] || '')

/** [short, full]: "4G rejected" and "4G rejected · weak signal …". */
export function roundSummary(round) {
  if (round.result === 'pending') return ['Filed', 'Filed · with coordinator']
  if (round.result === 'withdrawn') return ['Withdrawn', 'Withdrawn']
  if (round.result === 'returned') {
    return ['Returned', round.return_reason ? `Returned · ${round.return_reason}` : 'Returned']
  }
  const refused = round.claims.filter((c) => c.result === 'rejected')
  if (!refused.length) {
    const text = `${joinTechs(round.claims.map((c) => c.tech))} approved`
    return [text, text]
  }
  const short = `${joinTechs(refused.map((c) => c.tech))} rejected`
  const reasons = [...new Set(refused.map((c) => c.reason).filter(Boolean))]
  return [short, reasons.length ? `${short} · ${reasons.join('; ')}` : short]
}

/** The bottom note: "Round 1 · 4G rejected · weak signal at the village centre". */
export function lastReasonText(lastReason) {
  if (!lastReason) return ''
  const what = lastReason.kind === 'returned'
    ? 'Returned'
    : `${joinTechs(lastReason.techs)} rejected`
  return [`Round ${lastReason.round_no}`, what, lastReason.reason].filter(Boolean).join(' · ')
}

/** A Shamsi date or letter number as it is shown. */
export const shown = (text) => toPersianDigits(text || '')
