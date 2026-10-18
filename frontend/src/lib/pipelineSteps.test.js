import { describe, expect, it } from 'vitest'
import { STEPS, STRIP_STEPS, resolveTab, stepFigures, stepSpokenName, stepUrl } from './pipelineSteps'

describe('the pipeline steps', () => {
  it('run Assign, Checks, Assign, Tests, then Remediation and DT done', () => {
    expect(STRIP_STEPS.map((s) => s.key)).toEqual(['hc_assign', 'hc_checks', 'dt_assign', 'dt_tests', 'remediation', 'done'])
  })

  it.each([
    ['hc_assign', '/health-check?tab=assign'],
    ['hc_checks', '/health-check?tab=checks'],
    ['dt_assign', '/drive-test?tab=assign'],
    ['dt_tests', '/drive-test?tab=tests'],
    ['remediation', '/health-check?tab=remediation'],
  ])('%s lives at %s', (key, url) => {
    expect(stepUrl(STEPS.find((s) => s.key === key))).toBe(url)
  })
})

describe('what a ?tab= opens', () => {
  it.each([
    ['hc', null, 'hc_assign'], ['hc', 'checks', 'hc_checks'], ['dt', null, 'dt_assign'],
    ['dt', 'tests', 'dt_tests'], ['dt', 'done', 'done'], ['hc', 'nonsense', 'hc_assign'],
  ])('%s ?tab=%s is step %s', (page, tab, key) => {
    expect(resolveTab(page, tab).step.key).toBe(key)
  })

  it.each([
    ['hc', 'pool', '/health-check?tab=assign'],
    ['hc', 'basket', '/health-check?tab=assign'],
    ['hc', 'running', '/health-check?tab=checks'],
    ['hc', 'review', '/health-check?tab=checks&filter=to_decide'],
    ['hc', 'results', '/health-check?tab=checks&filter=to_decide'],
    ['dt', 'assignment', '/drive-test?tab=assign'],
    ['dt', 'in-progress', '/drive-test?tab=tests&view=with'],
    ['dt', 'review', '/drive-test?tab=tests&view=review'],
    ['dt', 'sent-back', '/drive-test?tab=tests&view=with'],
    ['hc', 'dt-assign', '/drive-test?tab=assign'],
  ])('redirects %s ?tab=%s to %s', (page, tab, url) => {
    expect(resolveTab(page, tab, new URLSearchParams(`tab=${tab}`)).redirect).toBe(url)
  })

  it('opens History on either page', () => {
    expect(resolveTab('hc', 'history')).toEqual({ history: true })
  })
})

describe('the step tiles', () => {
  it('add the to-decide count and lateness', () => {
    const step = STEPS.find((s) => s.key === 'dt_tests')
    const f = stepFigures(step, { dt5: { count: 200, late: 3 }, sent_back: { count: 5, late: 1 }, dt6: { count: 12, late: 0 } })
    expect(f).toMatchObject({ count: 205, decide: 12, late: 4 })
    expect(stepSpokenName(step, f)).toBe('Step 4, Tests: 205 sites, 12 to decide, 4 overdue, Contractors, then you')
  })
})
