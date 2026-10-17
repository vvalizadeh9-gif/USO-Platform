// UEP-13 §3.8: the map's six blue bands, their label inks and their tokens.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BANDS, bandOf } from './coverageMap'

const css = readFileSync(resolve(process.cwd(), 'src/styles/uep-tokens.css'), 'utf-8')

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]
}
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

describe('coverage map bands', () => {
  it('are the six UEP blues, mirrored as --uep-map-1…6', () => {
    BANDS.forEach((band, i) => {
      expect(css).toMatch(new RegExp(`--uep-map-${i + 1}:[ ]*${band.fill};`))
    })
  })

  it('pick a label ink that reaches 4.5:1 on every fill', () => {
    for (const band of BANDS) expect(contrast(band.fill, band.ink)).toBeGreaterThanOrEqual(4.5)
  })

  it('use dark ink on the light bands and white on the dark ones', () => {
    expect(BANDS.slice(0, 3).every((b) => b.ink === '#0F1F4B' && !b.dark)).toBe(true)
    expect(BANDS.slice(3).every((b) => b.ink === '#FFFFFF' && b.dark)).toBe(true)
  })

  it('maps a rate to its band', () => {
    expect(bandOf({ reached: 100, stopped: 90 }).fill).toBe('#E3EAFB')
    expect(bandOf({ reached: 100, stopped: 5 }).fill).toBe('#14318F')
    expect(bandOf({ reached: 3, stopped: 0, low_sample: true })).toBeNull()
  })
})
