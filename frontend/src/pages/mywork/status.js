// My Work's vocabulary as the page shows it.
//
// The server decides every rule -- which tab a village is in, what a side's
// status is, whether it can be filed or checked -- and sends role-neutral
// keys. This module only says what each key looks like. The words and tones
// live in statusVocabulary.json, which a backend test holds to the server's
// own list (tests/test_my_work.py), so the two vocabularies cannot drift.
import vocabulary from './statusVocabulary.json'

export const VIEW_CONTRACTOR = 'contractor'
export const VIEW_STAFF = 'staff'
export const AUTHORITIES = ['ICT', 'CRA']

const UNKNOWN = { label: '—', tone: 'neutral', slot: 0, outline: false }

/** The presentation of one side status. */
export function statusOf(key) {
  return vocabulary.statuses[key] || UNKNOWN
}

/** A tab's label for this viewer. */
export function tabLabel(key, view) {
  return vocabulary.tabs[key]?.[view] || key
}

/** The traffic light's three segments for one side, as this viewer reads it.
 *
 * Segment 1 is the submitter's ("You fill" / "Contractor"), and is named for
 * the trouble when the side came back (Returned, Rejected). The lit segment
 * carries the status tone; the others show their own soft tint. */
export function segmentsFor(statusKey, view) {
  const status = statusOf(statusKey)
  const labels = [...(vocabulary.segments[view] || vocabulary.segments.contractor)]
  if (status.slot === 0 && statusKey !== 'waiting') labels[0] = status.label
  const restingTone = ['pending', 'ongoing', 'success']
  return labels.map((label, slot) => ({
    label,
    lit: slot === status.slot,
    tone: slot === status.slot ? status.tone : restingTone[slot],
    outline: slot === status.slot && status.outline,
  }))
}

/** Every side that can take a letter right now. */
export const isFileable = (side) => Boolean(side?.editable)
