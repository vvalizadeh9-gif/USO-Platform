import IRAN from './iranMini.json'

/**
 * A small map of Iran with one province filled and a pin on its centre
 * (UEP-28 §B2). Paths and centroids are precomputed by
 * scripts/build-iran-mini.py; provinces are matched on their Persian name
 * exactly as the provinces table stores it, as on the coverage map.
 */
export default function ProvinceMap({ province }) {
  const me = province ? IRAN.provinces[province] : null
  return (
    <svg className="exp-map" viewBox={IRAN.viewBox} role="img" aria-label={me ? `Map of Iran, ${province} highlighted` : 'Map of Iran'}>
      {Object.entries(IRAN.provinces).map(([name, p]) => (
        <path key={name} d={p.d} className={name === province ? 'is-me' : undefined} />
      ))}
      {me && (
        <g className="exp-pin" style={{ '--exp-x': `${me.c[0]}px`, '--exp-y': `${me.c[1]}px` }} transform={`translate(${me.c[0]} ${me.c[1]})`}>
          <circle r="70" className="exp-pin-halo" />
          <circle r="26" className="exp-pin-dot" />
        </g>
      )}
    </svg>
  )
}
