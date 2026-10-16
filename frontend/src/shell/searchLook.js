// How the header search draws its results (UEP-12): one icon and tile hue per
// group, matched text, and which parts are Persian.

/**
 * Each result group's Carbon icon and tile tone. The tones reuse the app
 * tiles' hues (`.uep-search-tile[data-tone]` in shell.css): no new colours.
 */
export const GROUP_LOOK = Object.freeze({
  pages: { icon: 'document', tone: 'neutral' },
  sites: { icon: 'cell-tower', tone: 'drive-test' },
  villages: { icon: 'home', tone: 'acceptance' },
  provinces: { icon: 'location', tone: 'insights' },
  contractors: { icon: 'enterprise', tone: 'insights' },
  people: { icon: 'user', tone: 'neutral' },
  all: { icon: 'search', tone: 'accent' },
})

const PERSIAN = /[؀-ۿ]/

export const isPersian = (text) => PERSIAN.test(text || '')

const fold = (s) => (s || '').toLocaleLowerCase()

/**
 * `label` cut into runs, `hit` on every case-insensitive occurrence of `term`.
 * @returns {{ text: string, hit: boolean }[]}
 */
export function matchRuns(label, term) {
  const text = label || ''
  const t = fold((term || '').trim())
  const hay = fold(text)
  if (!t || hay.length !== text.length) return [{ text, hit: false }]
  const runs = []
  let from = 0
  for (let i = hay.indexOf(t); i !== -1; i = hay.indexOf(t, from)) {
    if (i > from) runs.push({ text: text.slice(from, i), hit: false })
    runs.push({ text: text.slice(i, i + t.length), hit: true })
    from = i + t.length
  }
  if (from < text.length) runs.push({ text: text.slice(from), hit: false })
  return runs
}
