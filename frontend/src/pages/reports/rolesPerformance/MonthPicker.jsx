// The Month title is the month picker: "شهریور ۱۴۰۵ ⌄" opens a dialog with a
// year row, a 3x4 grid of Shamsi months (future ones disabled, the running
// one captioned "so far") and "This month so far". Arrow keys move through
// the grid; Escape closes it and focus returns to the title.
import { useEffect, useRef, useState } from 'react'
import Icon from '../../../components/Icon'
import { SHAMSI_MONTHS } from '../../../lib/shamsi'
import { fa, isFutureMonth, monthLabel, sameMonth } from './model'

export default function MonthPicker({ month, current, firstYear, onChange }) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(month.year)
  const titleRef = useRef(null)
  const dialogRef = useRef(null)

  // Open on the shown month's year, focused on the shown month.
  useEffect(() => {
    if (!open) return undefined
    setYear(month.year)
    const pick = () => {
      dialogRef.current?.querySelector('[aria-pressed="true"]')?.focus()
        ?? dialogRef.current?.querySelector('.rp-mp-month:not(:disabled)')?.focus()
    }
    const id = requestAnimationFrame(pick)
    const onDown = (event) => {
      if (!dialogRef.current?.contains(event.target) && !titleRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    // Escape closes it wherever focus is (it may still be on the title).
    const onEscape = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      titleRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEscape)
    return () => {
      cancelAnimationFrame(id)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open, month.year])

  const close = () => {
    setOpen(false)
    titleRef.current?.focus()
  }
  const choose = (next) => {
    onChange(next)
    close()
  }

  const onKeyDown = (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[event.key]
    if (!step || !event.target.classList.contains('rp-mp-month')) return
    event.preventDefault()
    const buttons = [...dialogRef.current.querySelectorAll('.rp-mp-month')]
    let at = buttons.indexOf(event.target) + step
    while (at >= 0 && at < buttons.length && buttons[at].disabled) at += Math.sign(step)
    buttons[at]?.focus()
  }

  return (
    <span className="rp-mp">
      <button
        ref={titleRef}
        type="button"
        className="rp-title-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Choose month, ${monthLabel(month.year, month.month)} shown`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rp-fa">{monthLabel(month.year, month.month)}</span>
        <Icon name="chevron--down" size={20} />
      </button>
      {open && (
        <div ref={dialogRef} className="rp-mp-dialog" role="dialog" aria-label="Choose month"
          onKeyDown={onKeyDown}>
          <div className="rp-mp-year">
            <button type="button" className="rp-mp-nav" aria-label="Previous year"
              disabled={year <= firstYear} onClick={() => setYear((y) => y - 1)}>
              <Icon name="arrow--left" size={16} />
            </button>
            <span className="rp-fa" aria-live="polite">{fa(year)}</span>
            <button type="button" className="rp-mp-nav" aria-label="Next year"
              disabled={year >= current.year} onClick={() => setYear((y) => y + 1)}>
              <Icon name="arrow--right" size={16} />
            </button>
          </div>
          <div className="rp-mp-grid">
            {SHAMSI_MONTHS.map((name, i) => {
              const period = { year, month: i + 1 }
              const running = sameMonth(period, current)
              return (
                <button
                  key={name}
                  type="button"
                  className="rp-mp-month"
                  aria-pressed={sameMonth(period, month)}
                  disabled={isFutureMonth(period, current)}
                  onClick={() => choose(period)}
                >
                  <span className="rp-fa">{name}</span>
                  {running && <small>so far</small>}
                </button>
              )
            })}
          </div>
          <div className="rp-mp-foot">
            <button type="button" className="rp-mp-now" onClick={() => choose(current)}>
              This month so far
            </button>
          </div>
        </div>
      )}
    </span>
  )
}
