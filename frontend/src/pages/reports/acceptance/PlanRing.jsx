import { fmt } from './model'

const SIZE = 128
const STROKE = 11
const R = (SIZE - STROKE) / 2
const C = 2 * Math.PI * R

/**
 * One plan against what was delivered, as a ring (the month panel's two).
 *
 * The arc is the delivered share in the stream colour, from 12 o'clock,
 * capped at a full circle; the centre is the delivered count "of" the plan.
 * In the running month a 2.5px ink tick marks where an even pace would be
 * today. Under the ring: the plan's name beside its line swatch (the chart's
 * dashed or dotted line), the true share delivered -- which may pass 100 --
 * and the pace pill. A month with no plan is a neutral "No plan set" ring
 * and no pill: nothing is measured against a plan that does not exist.
 */
export default function PlanRing({ ring }) {
  const label = ring.noPlan
    ? `${ring.label}: no plan set`
    : `${ring.label}: ${fmt(ring.act)} of ${fmt(ring.plan)} delivered`
  return (
    <figure className="accd-ring" data-ring={ring.kind} aria-label={label}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} className="accd-ring-track" strokeWidth={STROKE} />
        {!ring.noPlan && ring.arc > 0 && (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            className="accd-ring-arc"
            strokeWidth={STROKE}
            strokeDasharray={`${ring.arc * C} ${C}`}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            data-testid="ring-arc"
            data-arc={ring.arc}
          />
        )}
        {ring.tick != null && !ring.noPlan && <Tick angle={ring.tick} />}
      </svg>
      <span className="accd-ring-centre">
        {ring.noPlan ? (
          <span className="accd-ring-none">No plan set</span>
        ) : (
          <>
            <b className="accd-ring-act tnum">{fmt(ring.act)}</b>
            <span className="accd-ring-of tnum">of {fmt(ring.plan)}</span>
          </>
        )}
      </span>
      <figcaption className="accd-ring-caption">
        <span className="accd-ring-name">
          <i className={`accd-swatch accd-swatch-${ring.swatch}`} aria-hidden="true" />
          {ring.label}
        </span>
        {!ring.noPlan && ring.pct != null && (
          <span className="accd-ring-pct">
            <b className="tnum">{ring.pct}%</b> delivered
          </span>
        )}
        {!ring.noPlan && (
          <span className={`accd-pill accd-pill-${ring.pace.tone} tnum`}>{ring.pace.text}</span>
        )}
      </figcaption>
    </figure>
  )
}

/** The due-by-today mark: a short ink line across the ring at `angle`. */
function Tick({ angle }) {
  const rad = ((angle - 90) * Math.PI) / 180
  const inner = R - STROKE / 2 - 3
  const outer = R + STROKE / 2 + 3
  const at = (r) => [SIZE / 2 + r * Math.cos(rad), SIZE / 2 + r * Math.sin(rad)]
  const [x1, y1] = at(inner)
  const [x2, y2] = at(outer)
  return <line x1={x1} y1={y1} x2={x2} y2={y2} className="accd-ring-tick" data-testid="ring-tick" />
}
