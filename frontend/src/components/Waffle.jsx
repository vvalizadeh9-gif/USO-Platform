/**
 * A grid of squares: `filled` of `total` in the authority's colour, the rest
 * in its faint base colour. Decoration only -- the figure beside it carries
 * the number -- so it is hidden from assistive technology.
 *
 * `columns` sets the grid (10 for the 10x10 waffle, 20 for a one-line strip).
 * `empty` draws a dotted grid with nothing counted: the "no data yet" state.
 * `size` picks the square size from the stylesheet: `tile` fills its width
 * (capped), `hero` is 7px squares, `mark` is the drawer rows' strip.
 */
export default function Waffle({
  filled = 0,
  total = 100,
  columns = 10,
  authority,
  empty = false,
  size = 'tile',
  className = '',
}) {
  const squares = Array.from({ length: total }, (_, index) => index < filled)
  return (
    <span
      className={`waffle waffle-size-${size} ${className}`.trim()}
      data-authority={authority?.toLowerCase()}
      data-empty={empty || undefined}
      style={{ '--waffle-cols': columns }}
      aria-hidden="true"
    >
      {squares.map((on, index) => (
        <i key={index} className={!empty && on ? 'on' : undefined} />
      ))}
    </span>
  )
}
