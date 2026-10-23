import { useEffect, useRef } from 'react'

// Hold a button and the number runs: the first tick after 400 ms, then +1
// every 110 ms for 12 ticks, then +5 every 60 ms.
const FIRST_DELAY = 400
const SLOW_MS = 110
const SLOW_TICKS = 12
const FAST_MS = 60
const FAST_STEP = 5

/** The most a stepper goes to: well past any plan, below a typo. */
export const STEPPER_MAX = 10_000

/**
 * − / number / +, and nothing else: no typing. A click moves by one, holding
 * repeats (see above) and the release adds no extra click.
 *
 * `label` names the number for assistive technology ("DT delivery, Alpha
 * Telecom"); `changed` turns the number accent; `size` is `plan` (48px
 * buttons) or `target` (52px, the number in a grey pill).
 */
export default function Stepper({ value, onChange, label, changed = false, disabled = false, min = 0, max = STEPPER_MAX, size = 'plan' }) {
  const valueRef = useRef(value)
  valueRef.current = value
  const timer = useRef(null)
  const fired = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const stop = () => {
    clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => stop, [])

  function move(by) {
    const next = Math.min(max, Math.max(min, valueRef.current + by))
    if (next === valueRef.current) return false
    valueRef.current = next
    onChangeRef.current(next)
    return true
  }

  function hold(direction) {
    const start = () => {
      fired.current = false
      stop()
      let ticks = 0
      const run = (delay) => {
        timer.current = setTimeout(() => {
          fired.current = true
          ticks += 1
          if (!move(direction * (ticks > SLOW_TICKS ? FAST_STEP : 1))) return stop()
          run(ticks >= SLOW_TICKS ? FAST_MS : SLOW_MS)
        }, delay)
      }
      run(FIRST_DELAY)
    }
    return {
      onPointerDown: start,
      onPointerUp: stop,
      onPointerLeave: stop,
      onPointerCancel: stop,
      onBlur: stop,
      onClick: (event) => {
        // A mouse click that ends a hold is the release, not a press. A
        // keyboard click (detail 0) is always a press.
        if (event.detail !== 0 && fired.current) {
          fired.current = false
          return
        }
        move(direction)
      },
    }
  }

  return (
    <div className="mp2-stepper" data-size={size} data-changed={changed || undefined}>
      <button type="button" className="mp2-step" aria-label="Decrease" disabled={disabled || value <= min} {...hold(-1)}>
        −
      </button>
      <span className="mp2-step-value tnum" role="status" aria-label={label}>
        {value}
      </span>
      <button type="button" className="mp2-step" aria-label="Increase" disabled={disabled || value >= max} {...hold(1)}>
        +
      </button>
    </div>
  )
}
