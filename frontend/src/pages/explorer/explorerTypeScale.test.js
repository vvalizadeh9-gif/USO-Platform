// UEP-28: one type scale on both Explorer pages. Every font-size in the
// stylesheet resolves, through uep-tokens.css, to 12/13/14/16/20/24/32.
// (Vitest serves CSS imports empty, so the files are read and resolved here;
// the Playwright spec walks the computed styles in a real browser.)
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SCALE = new Set([12, 13, 14, 16, 20, 24, 32])
const tokens = readFileSync('src/styles/uep-tokens.css', 'utf8')
const css = readFileSync('src/styles/explorer.css', 'utf8')

function resolve(value, depth = 0) {
  const v = value.trim()
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(v)
  if (!ref || depth > 5) return v
  const def = new RegExp(`${ref[1]}:\\s*([^;]+);`).exec(tokens)
  return def ? resolve(def[1], depth + 1) : v
}

describe('the Explorer type scale', () => {
  it('uses only 12, 13, 14, 16, 20, 24 and 32px', () => {
    const sizes = [...css.matchAll(/font-size:\s*([^;}]+)/g)].map((m) => [m[1].trim(), resolve(m[1])])
    expect(sizes.length).toBeGreaterThan(40)
    const off = sizes.filter(([, px]) => !SCALE.has(Number.parseFloat(px)) || !px.endsWith('px'))
    expect(off).toEqual([])
  })

  // UEP-30: one text rule on the passport. Village names medium, titles semibold.
  it('sets village names in 500 and passport section titles in 600', () => {
    const weight = (sel) => {
      const start = css.indexOf(`\n${sel} {`)
      const block = start < 0 ? '' : css.slice(start, css.indexOf('}', start))
      return resolve(/font-weight:\s*([^;]+)/.exec(block)?.[1] ?? '')
    }
    expect(weight('.exv-name')).toBe('500')
    expect(weight('.exp-title')).toBe('600')
    expect(weight('.exp-value')).toBe('500')
  })

  it('uses no inline colour: every colour is a token', () => {
    const literal = [...css.matchAll(/(?:^|[\s:,(])(#[0-9a-fA-F]{3,8})\b/g)].map((m) => m[1])
    expect(literal).toEqual([])
  })
})
