// A Carbon icon, coloured by `currentColor` so CSS recolours it with `color`.
// Decorative unless given a `label`, in which case it is announced as an image.
import { glyphFor } from './icons'

// Carbon writes SVG attributes as they appear in markup; React wants camelCase
// for the hyphenated presentation ones (fill-rule, stroke-width, ...).
const reactAttr = (name) =>
  name.startsWith('data-') || name.startsWith('aria-')
    ? name
    : name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

function renderNode({ elem: Element, attrs = {}, content = [] }, key) {
  const props = Object.fromEntries(Object.entries(attrs).map(([k, v]) => [reactAttr(k), v]))
  return (
    <Element key={key} {...props}>
      {content.map(renderNode)}
    </Element>
  )
}

/**
 * @param {{ name: import('./icons').IconName, size?: 16|18|20|22, label?: string, className?: string }} props
 */
export default function Icon({ name, size = 16, label, className, style }) {
  const glyph = glyphFor(name, size)
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={glyph.attrs.viewBox}
      width={size}
      height={size}
      fill="currentColor"
      focusable="false"
      className={className}
      style={style}
      data-icon={name}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {glyph.content.map(renderNode)}
    </svg>
  )
}
