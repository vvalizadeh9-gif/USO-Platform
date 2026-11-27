import { useLayoutEffect, useRef, useState } from 'react'
import { RIBBON, layoutRibbon, ribbonSummary } from './ribbonModel'

const R = RIBBON

/** The element's width, kept current as it resizes (0 until measured). */
function useWidth(ref) {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => setWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/** A label positioned on the ribbon; it fades in as the line reaches it. */
function Label({ x, y, width, className, children }) {
  return (
    <span className={`exr-label ${className}`.trim()} style={{ left: x, top: y, '--exr-t': width ? x / width : 0 }}>
      {children}
    </span>
  )
}

function Milestone({ m, y, width }) {
  const cls = `exr-ms ${m.big ? 'is-big' : ''} ${m.first ? 'is-first' : ''} ${m.future ? 'is-future' : ''}`
  return (
    <Label x={m.x} y={y} width={width} className={cls}>
      <span className="exr-ms-name">{m.name}</span>
      <span className="exr-ms-date">{m.date}</span>
    </Label>
  )
}

function Lanes({ lanes, width }) {
  return lanes.authorities.map((lane) => (
    <Label key={lane.key} x={lanes.b + 14} y={lane.y - 12} width={width} className={`exr-lane-label ${lane.all ? 'is-all' : ''}`}>
      <b className="auth-chip ex-auth" data-authority={lane.key}>{lane.key.toUpperCase()}</b>
      {lane.all ? (
        <span>All approved{lane.doneOn ? ` · ${lane.doneOn}` : ''}</span>
      ) : (
        <span><b>{lane.approved}</b> of {lane.total} approved</span>
      )}
    </Label>
  ))
}

function laneShapes(lanes) {
  const { a, start, b } = lanes
  return lanes.authorities.map((lane) => (
    <g key={lane.key}>
      <path
        className={`exr-lane is-${lane.key}`}
        d={`M${a} ${R.y} C ${a + (start - a) * 0.6} ${R.y}, ${a + (start - a) * 0.4} ${lane.y}, ${start} ${lane.y} L ${b} ${lane.y}`}
      />
      {lane.fillX > start && <path className={`exr-lane-fill is-${lane.key}`} d={`M${start} ${lane.y} L ${lane.fillX} ${lane.y}`} />}
    </g>
  ))
}

/** The drawing: tracks, dots and the Today line. Decorative; the container
 * carries the words. */
function Drawing({ layout }) {
  const { track, cuts, open, milestones, today, lanes, tail } = layout
  const half = R.track / 2
  return (
    <svg className="exr-svg" width={layout.width} height="100%" aria-hidden="true" focusable="false">
      {track && track.x1 > track.x0 && <rect className="exr-done" x={track.x0} y={R.y - half} width={track.x1 - track.x0} height={R.track} rx={half} />}
      {cuts.map((x) => <rect key={x} className="exr-cut" x={x - 1} y={R.y - half} width="2" height={R.track} />)}
      {open && <rect className="exr-open" x={open.x0} y={R.y - half} width={Math.max(0, open.x1 - open.x0)} height={R.track} rx={half} />}
      {lanes && laneShapes(lanes)}
      {lanes && <circle className={`exr-dot ${lanes.sent.done ? '' : 'is-future'}`} cx={lanes.sent.x} cy={lanes.authorities[0].y} r="5" />}
      {today != null && <line className="exr-today" x1={today} y1={R.y - 24} x2={today} y2={R.y + 24} />}
      {tail && <line className="exr-tail" x1={tail.x0} y1={R.y} x2={tail.x1} y2={R.y} />}
      {tail?.dots.map((d) => <circle key={d.key} className="exr-dot is-future" cx={d.x} cy={R.y} r="5" />)}
      {milestones.map((m) => (
        <g key={m.key}>
          <circle className={`exr-dot ${m.big ? 'is-big' : ''}`} cx={m.x} cy={R.y} r={m.big ? 9 : 6} />
          {m.big && <circle className="exr-dot-core" cx={m.x} cy={R.y} r="3.5" />}
        </g>
      ))}
    </svg>
  )
}

/**
 * The journey as a timeline (UEP-28 §B4), drawn at its real pixel width and
 * redrawn on resize. It reveals left to right once; labels fade in as the
 * line reaches them. `role="img"` with every step in its name.
 */
export default function JourneyRibbon({ record, today }) {
  const ref = useRef(null)
  const width = useWidth(ref)
  const input = {
    steps: record.journey.steps,
    lanes: record.journey.lanes,
    today,
    acceptanceStarted: record.acceptance_started,
  }
  const layout = width ? layoutRibbon(input, width) : null
  return (
    <div ref={ref} className="exr" role="img" aria-label={ribbonSummary(input)}>
      {layout && (
        <>
          <Drawing layout={layout} />
          <div aria-hidden="true">
            {layout.durations.map((d) => (
              <Label key={d.x} x={d.x} y={d.fork ? R.y - 42 : R.y - 30} width={width} className={`exr-dur ${d.open ? 'is-open' : ''}`}>
                {d.text}
              </Label>
            ))}
            {layout.milestones.map((m) => <Milestone key={m.key} m={m} y={R.y + 16} width={width} />)}
            {layout.lanes && (
              <>
                <Lanes lanes={layout.lanes} width={width} />
                <Milestone
                  m={{ key: 'sent_to_ict', x: layout.lanes.sent.labelX, name: 'Sent to ICT', date: layout.lanes.sent.date, future: !layout.lanes.sent.done }}
                  y={R.y + R.laneOffset + 10}
                  width={width}
                />
              </>
            )}
            {layout.today != null && (
              <Label x={layout.today} y={R.y + 28} width={width} className="exr-today-label">Today</Label>
            )}
            {layout.tail?.dots.map((d) => (
              <Milestone key={d.key} m={{ ...d, future: true }} y={R.y + 16} width={width} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
