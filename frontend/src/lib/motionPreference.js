// Reduced motion.
//
// UEP follows the system's prefers-reduced-motion. The result is written to
// <html data-uep-motion="reduce|full">, and the stylesheets key every
// non-essential animation off that one attribute.
//
// The review flag: add ?motion=reduce (or ?motion=full) to any URL to force a
// mode, which is remembered in this browser; ?motion=system goes back to
// following the operating system.
const PARAM = 'motion'
const STORAGE_KEY = 'uep_motion'
const QUERY = '(prefers-reduced-motion: reduce)'
const MODES = new Set(['reduce', 'full'])

/**
 * @param {{ override: string | null, systemReduces: boolean }} input
 * @returns {'reduce' | 'full'}
 */
export function resolveMotion({ override, systemReduces }) {
  if (MODES.has(override)) return /** @type {'reduce'|'full'} */ (override)
  return systemReduces ? 'reduce' : 'full'
}

function readOverride(search) {
  const fromUrl = new URLSearchParams(search).get(PARAM)
  try {
    if (fromUrl === 'system') localStorage.removeItem(STORAGE_KEY)
    else if (MODES.has(fromUrl)) localStorage.setItem(STORAGE_KEY, fromUrl)
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage blocked: the URL still works for this page load.
    return MODES.has(fromUrl) ? fromUrl : null
  }
}

/**
 * Apply the preference to <html>, and keep following the system setting.
 * @param {Window} win
 * @returns {'reduce' | 'full'} the mode applied now
 */
export function applyMotionPreference(win = window) {
  const override = readOverride(win.location.search)
  const media = win.matchMedia?.(QUERY)
  const apply = () => {
    const mode = resolveMotion({ override, systemReduces: Boolean(media?.matches) })
    win.document.documentElement.dataset.uepMotion = mode
    return mode
  }
  media?.addEventListener?.('change', apply)
  return apply()
}
