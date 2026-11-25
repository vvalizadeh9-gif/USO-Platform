// System health formatting and thresholds (UEP-25); the server's rules are
// tested in backend/tests/test_system_health.py.
import { describe, expect, it } from 'vitest'
import { agoText, areaPoints, daysSince, formatBytes, formatGrowth, gaugeState } from './healthModel'

describe('System health formatting', () => {
  it('formats bytes up to terabytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(3.4 * 1024 ** 3)).toBe('3.4 GB')
    expect(formatBytes(null)).toBe('—')
  })

  it('signs growth', () => {
    expect(formatGrowth(120 * 1024 ** 2)).toBe('+120 MB')
    expect(formatGrowth(-4 * 1024 ** 2)).toBe('−4.0 MB')
    expect(formatGrowth(0)).toBe('No change')
  })

  it('turns a gauge amber at 75 % and red at 90 %', () => {
    expect(gaugeState(74.9)).toBe('ok')
    expect(gaugeState(75)).toBe('amber')
    expect(gaugeState(90)).toBe('red')
    expect(gaugeState(null)).toBe('unknown')
  })

  it('counts days since a date', () => {
    const today = new Date('2026-11-25T10:00:00Z')
    expect(daysSince('2026-11-17', today)).toBe(8)
    expect(agoText(0)).toBe('today')
    expect(agoText(1)).toBe('yesterday')
    expect(agoText(8)).toBe('8 days ago')
  })

  it('maps a series onto the chart box', () => {
    const pts = areaPoints([{ day: 'a', v: 0 }, { day: 'b', v: 10 }], 'v', 100, 50, 0)
    expect(pts[0]).toMatchObject({ x: 0, y: 50 })
    expect(pts[1]).toMatchObject({ x: 100, y: 0 })
  })
})
