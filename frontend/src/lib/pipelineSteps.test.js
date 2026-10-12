import { describe, expect, it } from 'vitest'
import { STEPS, resolveTab, stepSpokenName, stepUrl, volumeWidths } from './pipelineSteps'

describe('the pipeline steps', () => {
  it('run 1–6, then DT done, then the three loops', () => {
    expect(STEPS.map((s) => s.key)).toEqual([
      'hc1', 'hc2', 'hc3', 'dt4', 'dt5', 'dt6', 'done', 'remediation', 'reroutes', 'sent_back',
    ])
  })

  it.each([
    ['hc1', '/health-check?tab=pool'],
    ['hc2', '/health-check?tab=running'],
    ['hc3', '/health-check?tab=review'],
    ['dt4', '/drive-test?tab=assignment'],
    ['dt5', '/drive-test?tab=in-progress'],
    ['dt6', '/drive-test?tab=review'],
    ['remediation', '/health-check?tab=remediation'],
    ['reroutes', '/health-check?tab=reroutes'],
    ['sent_back', '/drive-test?tab=sent-back'],
  ])('%s lives at %s', (key, url) => {
    expect(stepUrl(STEPS.find((s) => s.key === key))).toBe(url)
  })
})

describe('what a ?tab= opens', () => {
  it.each([
    ['hc', 'pool', 'hc1'], ['hc', 'basket', 'hc1'], ['hc', null, 'hc1'],
    ['hc', 'running', 'hc2'], ['hc', 'review', 'hc3'], ['hc', 'results', 'hc3'],
    ['dt', null, 'dt4'], ['dt', 'assignment', 'dt4'], ['dt', 'in-progress', 'dt5'],
    ['dt', 'review', 'dt6'], ['dt', 'done', 'done'], ['dt', 'sent-back', 'sent_back'],
    ['hc', 'nonsense', 'hc1'],
  ])('%s ?tab=%s is step %s', (page, tab, key) => {
    expect(resolveTab(page, tab).step.key).toBe(key)
  })

  it('opens History on either page', () => {
    expect(resolveTab('hc', 'history')).toEqual({ history: true })
    expect(resolveTab('dt', 'history')).toEqual({ history: true })
  })

  it('sends the old drive-test keys on to the Drive test page, keeping the query', () => {
    expect(resolveTab('hc', 'dt-assign').redirect).toBe('/drive-test?tab=assignment')
    const r = resolveTab('hc', 'dt-review', new URLSearchParams('tab=dt-review&site=ABC'))
    expect(r.redirect).toContain('tab=review')
    expect(r.redirect).toContain('site=ABC')
  })
})

describe('the strip', () => {
  it('names a tab with its count, lateness and owner', () => {
    const step = STEPS.find((s) => s.key === 'dt5')
    expect(stepSpokenName(step, { count: 263, late: 4 })).toBe('Step 5, In test: 263 sites, 4 late, with contractors')
    expect(stepSpokenName(step, { count: 1, late: 0 })).toBe('Step 5, In test: 1 site, with contractors')
    expect(stepSpokenName(STEPS.find((s) => s.key === 'reroutes'), { count: 0, late: 0 })).toBe('Re-routes: 0 sites, waiting on you')
  })

  it('draws volume bars against the largest of the six steps, never under 3%', () => {
    const w = volumeWidths({ hc1: { count: 200 }, hc2: { count: 100 }, hc3: { count: 0 }, dt4: { count: 50 }, done: { count: 9000 } })
    expect(w.hc1).toBe(100)
    expect(w.hc2).toBe(50)
    expect(w.dt4).toBe(25)
    expect(w.hc3).toBe(3)
    expect(w.done).toBeUndefined()
  })
})
