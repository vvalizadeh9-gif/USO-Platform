import { afterEach, describe, expect, it } from 'vitest'
import { applyMotionPreference, resolveMotion } from './motionPreference'

function fakeWindow(search, systemReduces) {
  return {
    location: { search },
    matchMedia: () => ({ matches: systemReduces, addEventListener: () => {} }),
    document,
  }
}

afterEach(() => {
  delete document.documentElement.dataset.uepMotion
})

describe('resolveMotion', () => {
  it('follows the system when nothing is forced', () => {
    expect(resolveMotion({ override: null, systemReduces: true })).toBe('reduce')
    expect(resolveMotion({ override: null, systemReduces: false })).toBe('full')
  })

  it('lets the review flag win either way', () => {
    expect(resolveMotion({ override: 'reduce', systemReduces: false })).toBe('reduce')
    expect(resolveMotion({ override: 'full', systemReduces: true })).toBe('full')
  })

  it('ignores a value it does not know', () => {
    expect(resolveMotion({ override: 'slow', systemReduces: false })).toBe('full')
  })
})

describe('applyMotionPreference', () => {
  it('marks <html> with the mode', () => {
    applyMotionPreference(fakeWindow('', true))
    expect(document.documentElement.dataset.uepMotion).toBe('reduce')
  })

  it('remembers ?motion=reduce until ?motion=system', () => {
    applyMotionPreference(fakeWindow('?motion=reduce', false))
    expect(applyMotionPreference(fakeWindow('', false))).toBe('reduce')
    expect(applyMotionPreference(fakeWindow('?motion=system', false))).toBe('full')
  })
})
