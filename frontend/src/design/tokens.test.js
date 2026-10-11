// The CSS tokens are the source of truth; the script copy must not drift.
import { describe, expect, it } from 'vitest'
import { appColor, color, cssVar, motion } from './tokens'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Vitest runs from frontend/.
const css = readFileSync(resolve(process.cwd(), 'src/styles/uep-tokens.css'), 'utf-8')

const cssValue = (name) => {
  const match = css.match(new RegExp(`--uep-${name}:\\s*([^;]+);`))
  return match ? match[1].trim() : undefined
}

const kebab = (key) => key.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()

describe('design tokens', () => {
  it.each(Object.entries(color))('color.%s matches the stylesheet', (key, value) => {
    expect(cssValue(kebab(key))).toBe(value)
  })

  it.each(Object.entries(appColor))('the %s app colours match the stylesheet', (key, { tile, tint }) => {
    expect(cssValue(`app-${kebab(key)}`)).toBe(tile)
    if (tint) expect(cssValue(`app-${kebab(key)}-tint`)).toBe(tint)
  })

  it('motion durations and easings match the stylesheet', () => {
    expect(cssValue('dur-fast')).toBe(`${motion.durFast}ms`)
    expect(cssValue('dur-pop')).toBe(`${motion.durPop}ms`)
    expect(cssValue('dur-enter')).toBe(`${motion.durEnter}ms`)
    expect(cssValue('dur-slow')).toBe(`${motion.durSlow}ms`)
    expect(cssValue('ease-productive')).toBe(motion.easeProductive)
    expect(cssValue('ease-entrance')).toBe(motion.easeEntrance)
    expect(cssValue('ease-expressive')).toBe(motion.easeExpressive)
  })

  it('builds var() references', () => {
    expect(cssVar('accent')).toBe('var(--uep-accent)')
  })
})
