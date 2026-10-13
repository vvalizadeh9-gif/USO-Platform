// The deviation bar on Area: grey up to the lower of the rate and the
// reference (national), then the difference -- solid accent when better,
// light red stripes when worse -- and a tick at the reference. The difference
// is the only coloured part. Built once; the National row uses it too.

const clamp = (value) => Math.min(Math.max(value ?? 0, 0), 100)

export default function RankBar({ rate, reference, label, national = false }) {
  const value = clamp(rate)
  const ref = clamp(reference)
  const low = Math.min(value, ref)
  const high = Math.max(value, ref)
  const tone = value < ref ? 'worse' : 'better'
  return (
    <span className={`rp-rankbar${national ? ' rp-rankbar-national' : ''}`} role="img"
      aria-label={label}>
      <span className="rp-rankbar-fill" style={{ width: `${low}%` }} />
      {high > low && (
        <span
          className={`rp-rankbar-diff rp-rankbar-${tone}`}
          style={{ left: `${low}%`, width: `${high - low}%` }}
        />
      )}
      <span className="rp-rankbar-tick" style={{ left: `${ref}%` }} />
    </span>
  )
}
