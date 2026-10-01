// What the buttons do: check the side, build the request, hold it for Undo.
//
// Every action is held by useDeferredSend and only then sent, so the form is
// cleared at once and comes back (with the server's errors in its fields) if
// the send is undone or refused.
import { useCallback } from 'react'
import { detailMessage } from '../../lib/apiError'
import { LETTERS_PATH, REVIEW_PATH, fileLetter, reviewLetter, uploadScan } from './api'
import { claimsFor, claimsFromRejections } from './useFilingForms'
import { hasErrors, letterErrors, reasonErrors, rejectionErrors, serverErrors } from './validation'

/** The errors one side shows: its own checks once tried, plus the server's. */
export function sideErrors(form, { villageId, toFile } = {}) {
  if (!form.tried) return { fields: {}, reasons: {}, rejections: [] }
  const server = form.server || {}
  const own = villageId != null ? reasonErrors(pick(form.verdicts[villageId], toFile)) : {}
  return {
    fields: { ...letterErrors(form.letter), ...(server.fields || {}) },
    reasons: { ...own, ...(server.reasons?.[villageId] || {}) },
    rejections: form.rejections.map(rejectionErrors),
    message: server.other?.length ? server.message : null,
  }
}

function pick(verdicts, techs) {
  if (!verdicts || !techs) return verdicts
  return Object.fromEntries(Object.entries(verdicts).filter(([t]) => techs.includes(t)))
}

function blocking(errors) {
  return hasErrors(errors.fields) || hasErrors(errors.reasons)
    || errors.rejections.some((e) => hasErrors(e))
}

const decidedStatus = (claims) => (claims.some((c) => c.result === 'rejected') ? 'rejected' : 'approved')

export function useLetterActions({ decides, forms, actions, deferred, refresh, toast }) {
  const attachScan = useCallback(async (authority, file) => {
    actions.letter(authority, { scan: { uploading: true, filename: file.name } })
    try {
      const scan = await uploadScan(file)
      actions.letter(authority, { scan: { scanId: scan.scan_id, filename: scan.filename } })
    } catch (err) {
      actions.letter(authority, { scan: { error: detailMessage(err, 'The scan was not accepted') } })
    }
  }, [actions])

  const holdLetter = useCallback((authority, items, who, rounds) => {
    const form = forms[authority]
    const body = {
      authority,
      letter_number: form.letter.number.trim(),
      letter_date: form.letter.date.trim(),
      scan_id: form.letter.scan.scanId,
      items,
    }
    const snapshot = form
    actions.clear(authority)
    deferred.hold({
      text: `${decides ? 'Saved' : 'Sent'} ${authority} for ${who}`,
      path: LETTERS_PATH,
      body,
      run: () => fileLetter(body),
      overlay: {
        authority,
        sides: Object.fromEntries(items.map((item) => [item.village_id, {
          status: decides ? decidedStatus(item.claims) : 'filled',
          round: {
            submission_id: `held-${item.village_id}`,
            round_no: rounds[item.village_id] || 1,
            letter_number: body.letter_number,
            letter_date_shamsi: body.letter_date,
            result: decides ? decidedStatus(item.claims) : 'pending',
            claims: item.claims,
          },
        }])),
      },
      onDone: refresh,
      onUndo: () => actions.restore(authority, snapshot),
      onFail: (err) => {
        const mapped = serverErrors(err?.response?.data?.detail
          || { message: detailMessage(err, 'Nothing was sent'), errors: [{ code: 'error' }] })
        actions.restore(authority, snapshot)
        // A scan the server no longer accepts has to be attached again.
        if (mapped.fields.scan) actions.letter(authority, { scan: null })
        actions.server(authority, mapped)
      },
    })
  }, [forms, actions, deferred, decides, refresh])

  /** One village: Send ICT / Save ICT. */
  const sendOne = useCallback((authority, row, side) => {
    const form = forms[authority]
    const errors = sideErrors({ ...form, tried: true, server: null }, { villageId: row.village_id, toFile: side.to_file })
    if (blocking(errors)) {
      actions.tried(authority, true)
      return
    }
    const claims = claimsFor(form.verdicts[row.village_id], side.to_file)
    holdLetter(authority, [{ village_id: row.village_id, claims }], row.village_name,
      { [row.village_id]: side.next_round_no })
  }, [forms, actions, holdLetter])

  /** Many villages: Send ICT · N. */
  const sendMany = useCallback((authority, fileable) => {
    const form = forms[authority]
    const errors = sideErrors({ ...form, tried: true, server: null })
    if (blocking(errors)) {
      actions.tried(authority, true)
      return
    }
    const items = fileable.map((row) => ({
      village_id: row.village_id,
      claims: claimsFromRejections(row, authority, form.rejections),
    }))
    holdLetter(authority, items, `${fileable.length} villages`,
      Object.fromEntries(fileable.map((row) => [row.village_id, row.sides[authority].next_round_no])))
  }, [forms, actions, holdLetter])

  const holdReview = useCallback((authority, body, { text, villages }) => {
    deferred.hold({
      text,
      path: REVIEW_PATH,
      body: { authority, ...body },
      run: () => reviewLetter({ authority, ...body }),
      overlay: { authority, sides: villages },
      onDone: refresh,
      onFail: (err) => toast.error('Nothing was decided', detailMessage(err)),
    })
  }, [deferred, refresh, toast])

  const confirm = useCallback((authority, row, round) => {
    holdReview(authority, { submission_ids: [round.submission_id], decision: 'confirm' }, {
      text: `Confirmed ${authority} for ${row.village_name}`,
      villages: { [row.village_id]: { status: decidedStatus(round.claims) } },
    })
  }, [holdReview])

  const confirmAll = useCallback((authority, row, round, count) => {
    holdReview(authority, { letter_number: round.letter_number, decision: 'confirm' }, {
      text: `Confirmed ${authority} for ${count} villages`,
      villages: { [row.village_id]: { status: decidedStatus(round.claims) } },
    })
  }, [holdReview])

  const giveBack = useCallback((authority, row, round, reason) => {
    holdReview(authority, { submission_ids: [round.submission_id], decision: 'return', reason }, {
      text: `Returned ${authority} for ${row.village_name}`,
      villages: { [row.village_id]: { status: 'returned' } },
    })
  }, [holdReview])

  return { attachScan, sendOne, sendMany, confirm, confirmAll, giveBack }
}
