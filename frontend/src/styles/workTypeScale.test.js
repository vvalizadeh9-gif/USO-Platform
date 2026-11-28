// UEP-31: the Drive test pages use only the type scale 12 / 13 / 14 / 16 / 24,
// and no inline hex colour.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest runs from frontend/.
const read = (name) => readFileSync(resolve(process.cwd(), 'src/styles', name), 'utf-8')
const tokens = read('uep-tokens.css')
const token = (name) => tokens.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim()

const SHEETS = ['work.css', 'work-dt.css', 'admin-contractors.css', 'my-health-check.css']

describe.each(SHEETS)('%s', (sheet) => {
  const css = read(sheet)

  it('sets every font size on the 12 / 13 / 14 / 16 / 24 scale', () => {
    const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map(([, v]) => {
      const name = v.match(/var\((--uep-[\w-]+)\)/)?.[1]
      return name ? token(name) : v.trim()
    })
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes.filter((s) => !['12px', '13px', '14px', '16px', '24px'].includes(s))).toEqual([])
  })

  it('takes every colour from a token', () => {
    expect(css.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull()
  })
})
