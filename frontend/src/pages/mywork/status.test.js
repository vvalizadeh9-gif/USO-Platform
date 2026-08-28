// The workspace vocabulary, and the two functions that decide what a queue row
// says about itself.
//
// These matter more than their size suggests. `rowStatus` and `queueReason`
// are the frontend's reading of the same per-authority statuses the backend
// computes in services/acceptance_workflow.py, and the two have to agree:
// a village the server put in "needs attention" that the row renders as
// approved is work that silently goes missing.
import { describe, expect, it } from 'vitest'
import {
  AUTHORITY_LABEL,
  AUTHORITY_PILL,
  AUTHORITY_TONE,
  bucketsFor,
  errorText,
  queueReason,
  rowStatus,
} from './status'

// The five values villages.ict_status / cra_status can hold. Kept literal
// rather than imported, so that a rename on the server is caught here as a
// failure rather than absorbed silently on both sides at once.
const AUTHORITY_STATUSES = ['Approved', 'Rejected', 'Returned', 'Pending', 'NotFiled']

describe('the status vocabulary', () => {
  it('has a label, a pill and a tone for every status the API can send', () => {
    for (const status of AUTHORITY_STATUSES) {
      expect(AUTHORITY_LABEL[status], `label for ${status}`).toBeTruthy()
      expect(AUTHORITY_PILL[status], `pill for ${status}`).toBeTruthy()
      expect(AUTHORITY_TONE[status], `tone for ${status}`).toBeTruthy()
    }
  })

  it('renames the two that would read wrongly to a person', () => {
    // To the contractor who filed it, the letter is not "pending" -- it is
    // with someone else. And "NotFiled" is an enum, not a sentence.
    expect(AUTHORITY_LABEL.Pending).toBe('In review')
    expect(AUTHORITY_LABEL.NotFiled).toBe('Not filed')
  })
})

describe('rowStatus', () => {
  it('reports the more urgent of the two authorities', () => {
    expect(rowStatus({ ict_status: 'Approved', cra_status: 'Returned' })).toBe('Returned')
    expect(rowStatus({ ict_status: 'Pending', cra_status: 'Approved' })).toBe('Pending')
  })

  it('ranks returned and rejected above anything in flight', () => {
    // Whose move is it: a returned submission is the contractor's problem now,
    // and must not be buried under the other authority still being in review.
    expect(rowStatus({ ict_status: 'Returned', cra_status: 'Pending' })).toBe('Returned')
    expect(rowStatus({ ict_status: 'Pending', cra_status: 'Rejected' })).toBe('Rejected')
  })

  it('only says Approved when both authorities have approved', () => {
    expect(rowStatus({ ict_status: 'Approved', cra_status: 'Approved' })).toBe('Approved')
    expect(rowStatus({ ict_status: 'Approved', cra_status: 'NotFiled' })).toBe('NotFiled')
  })
})

describe('queueReason', () => {
  it('names every authority that needs something', () => {
    const reason = queueReason({ ict_status: 'Returned', cra_status: 'NotFiled' })
    expect(reason).toContain('ICT returned')
    expect(reason).toContain('CRA not filed')
  })

  it('says so plainly when there is nothing left to do', () => {
    expect(queueReason({ ict_status: 'Approved', cra_status: 'Approved' })).toBe(
      'Approved by both authorities',
    )
  })

  it('appends how long it has been waiting, when it has', () => {
    expect(
      queueReason({ ict_status: 'Pending', cra_status: 'Approved', waiting_days: 12 }),
    ).toContain('12d')
  })

  it('says nothing about waiting on a village nothing has happened to', () => {
    // waiting_days is null for a village with no submission history. "0d"
    // would read as "acted on today", which is the opposite of the truth.
    const reason = queueReason({
      ict_status: 'NotFiled',
      cra_status: 'NotFiled',
      waiting_days: null,
    })
    // Not `toContain('d')` -- "not filed" contains a d. What must be absent is
    // a day count.
    expect(reason).not.toMatch(/\d+d/)
    expect(reason).toBe('ICT not filed · CRA not filed')
  })
})

describe('bucketsFor', () => {
  it('offers a reviewer their own queue first', () => {
    for (const role of ['PM', 'Coordinator']) {
      expect(bucketsFor(role)[0].key).toBe('awaiting_review')
    }
  })

  it('offers a submitter what came back to them first', () => {
    expect(bucketsFor('Contractor')[0].key).toBe('needs_attention')
  })

  it('treats an unknown role as a submitter rather than showing nothing', () => {
    // A role added on the server that the frontend has not heard of must still
    // get a usable screen.
    expect(bucketsFor('SomeFutureRole')).toEqual(bucketsFor('Contractor'))
  })

  it('only offers buckets the API knows about', () => {
    const known = ['needs_attention', 'ready', 'awaiting_review', 'closed', 'recently_validated']
    for (const role of ['PM', 'Coordinator', 'Contractor']) {
      for (const bucket of bucketsFor(role)) {
        expect(known, `${role} offered ${bucket.key}`).toContain(bucket.key)
      }
    }
  })
})

describe('errorText', () => {
  it('shows the API detail when there is one', () => {
    const err = { response: { data: { detail: 'A letter number is required' } } }
    expect(errorText(err, 'fallback')).toBe('A letter number is required')
  })

  it('unwraps the bulk-submission shape, which nests its message', () => {
    const err = { response: { data: { detail: { message: '3 of 40 failed' } } } }
    expect(errorText(err, 'fallback')).toBe('3 of 40 failed')
  })

  it('falls back rather than rendering [object Object] at a person', () => {
    // A 422 from pydantic sends a list of field errors here. Whatever it is,
    // the user must not be shown a stringified object.
    const err = { response: { data: { detail: [{ msg: 'too short' }] } } }
    expect(errorText(err, 'Could not save')).toBe('Could not save')
  })

  it('falls back when the request never reached the server', () => {
    expect(errorText(new Error('Network Error'), 'Could not save')).toBe('Could not save')
    expect(errorText(undefined, 'Could not save')).toBe('Could not save')
  })
})
