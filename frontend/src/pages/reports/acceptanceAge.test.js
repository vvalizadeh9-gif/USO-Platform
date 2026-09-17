import { describe, expect, it } from 'vitest'
import {
  AGE_BANDS,
  AGE_CRITICAL_DAYS,
  AGE_META,
  AGE_WARN_DAYS,
  ageTone,
  bandTotal,
} from './acceptanceAge'

describe('age bands', () => {
  it('names every band the API can send', () => {
    // The keys are the API's (acceptance_workflow.AGE_BUCKETS). A band the
    // dashboard cannot name would be dropped from a bar silently, and the bar
    // would stop summing to the outstanding count beside it.
    expect(AGE_BANDS).toEqual(['lt_warn', 'warn', 'critical', 'unknown'])
    for (const band of AGE_BANDS) {
      expect(AGE_META[band].label).toBeTruthy()
      expect(AGE_META[band].color).toBeTruthy()
    }
  })

  it('keeps undated villages out of the youngest band', () => {
    // An undated village is unmeasured, not new. Colouring it as fresh is
    // exactly the blind spot this clock exists to remove.
    expect(AGE_META.unknown.color).not.toBe(AGE_META.lt_warn.color)
  })
})

describe('ageTone', () => {
  it('escalates at the two thresholds', () => {
    expect(ageTone(0)).toBe('is-ok')
    expect(ageTone(AGE_WARN_DAYS - 1)).toBe('is-ok')
    expect(ageTone(AGE_WARN_DAYS)).toBe('is-slipping')
    expect(ageTone(AGE_CRITICAL_DAYS - 1)).toBe('is-slipping')
    expect(ageTone(AGE_CRITICAL_DAYS)).toBe('is-bad')
  })

  it('treats no age as absent, never as zero', () => {
    // A dash means nothing is outstanding, which is the good case; zero days
    // would read as "outstanding since today", which is not the same claim.
    expect(ageTone(null)).toBe('is-none')
    expect(ageTone(undefined)).toBe('is-none')
    expect(ageTone(0)).not.toBe('is-none')
  })
})

describe('bandTotal', () => {
  it('sums every band, including the undated one', () => {
    expect(bandTotal({ lt_warn: 3, warn: 2, critical: 1, unknown: 4 })).toBe(10)
  })

  it('tolerates a missing or partial bucket map', () => {
    // Older payloads, and provinces with nothing outstanding, send neither.
    expect(bandTotal(undefined)).toBe(0)
    expect(bandTotal({})).toBe(0)
    expect(bandTotal({ critical: 2 })).toBe(2)
  })
})
