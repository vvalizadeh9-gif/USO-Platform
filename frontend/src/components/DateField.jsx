import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MONTHS, formatLong, fromIso, toIso, todayIso } from '../lib/dates'

/**
 * A Gregorian date field that reads the same for everybody.
 *
 * This replaces <input type="date">, which had two problems that no amount of
 * styling fixes. It renders in the browser's own locale, so the same day showed
 * as 09/08/2026 to one reader and 08/09/2026 to another with nothing on screen
 * to say which was meant -- and an operations date that is off by a month is
 * worse than one that is hard to type. And the panel beside it prints ISO
 * (2026-09-08), so a single screen carried two formats of the same fact.
 *
 * So the format is pinned to ISO here, in every browser and every locale, and
 * the calendar is drawn by us rather than by the browser. The month grid is
 * plain Date arithmetic -- Date *is* the Gregorian calendar, so there is no
 * second implementation to disagree with the server, which is the objection
 * that keeps ShamsiDate a set of selects.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Monday-first, to match the ISO dates the field displays.
function startOfGrid(year, month) {
  const first = new Date(year, month, 1)
  const shift = (first.getDay() + 6) % 7
  return new Date(year, month, 1 - shift)
}

/**
 * How many weeks this month actually needs — four to six.
 *
 * A fixed six-row grid keeps the popup the same height all year, but it buys
 * that with a row that is entirely next month whenever the month is short
 * enough, which is a whole week of numbers that mean nothing. The popup is
 * anchored at its top and grows downward, so a month that needs one row fewer
 * moves nothing above it.
 */
function weeksInGrid(year, month) {
  const shift = (new Date(year, month, 1).getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  return Math.ceil((shift + days) / 7)
}

export default function DateField({ value, onChange, id, disabled }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(value || '')
  const [cursor, setCursor] = useState(() => fromIso(value) || new Date())
  const wrapRef = useRef(null)
  const gridRef = useRef(null)

  // The typed text is a draft; `value` stays the committed date. Re-sync when
  // the date changes from outside (a reset after submit, say).
  useEffect(() => { setText(value || '') }, [value])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openAt = () => {
    setCursor(fromIso(value) || new Date())
    setOpen(true)
  }

  const commit = (iso) => {
    onChange(iso)
    setOpen(false)
  }

  // Typing is allowed and is the fast path for anyone who knows the date;
  // it only reaches onChange once it is a real day.
  const onType = (e) => {
    const next = e.target.value
    setText(next)
    if (fromIso(next)) {
      onChange(next)
      setCursor(fromIso(next))
    }
  }

  const invalid = text.length > 0 && !fromIso(text)

  const start = startOfGrid(cursor.getFullYear(), cursor.getMonth())
  const cells = weeksInGrid(cursor.getFullYear(), cursor.getMonth()) * 7
  const days = Array.from({ length: cells }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  )
  const today = todayIso()

  // Arrow keys walk the grid a day at a time, which is how a keyboard user
  // corrects "not that Tuesday, the one before".
  const onGridKey = (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (step) {
      e.preventDefault()
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + step))
      return
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      const dir = e.key === 'PageUp' ? -1 : 1
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, cursor.getDate()))
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      commit(toIso(cursor))
    }
  }

  return (
    <div className="datefield" ref={wrapRef}>
      <div className={`datefield-control ${invalid ? 'input-error' : ''}`}>
        <input
          id={id}
          className="datefield-input tnum"
          value={text}
          disabled={disabled}
          onChange={onType}
          onFocus={() => setOpen(false)}
          placeholder="YYYY-MM-DD"
          inputMode="numeric"
          autoComplete="off"
          aria-label="Date, as YYYY-MM-DD"
        />
        <button
          type="button"
          className="datefield-toggle"
          disabled={disabled}
          aria-label="Open calendar"
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : openAt())}
        >
          <Calendar size={15} />
        </button>
      </div>

      {invalid ? (
        <small className="field-error">Use YYYY-MM-DD — that is not a real date.</small>
      ) : (
        <small className="dim" style={{ fontSize: 12 }}>
          {value === today ? 'Today' : formatLong(value)}
        </small>
      )}

      {open && (
        <div className="datefield-pop" role="dialog" aria-label="Choose a date">
          <div className="datefield-head">
            <button
              type="button" className="datefield-nav" aria-label="Previous month"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            >
              <ChevronLeft size={16} />
            </button>
            <b>{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</b>
            <button
              type="button" className="datefield-nav" aria-label="Next month"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="datefield-week">
            {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
          </div>

          <div
            className="datefield-grid"
            ref={gridRef}
            tabIndex={0}
            role="grid"
            onKeyDown={onGridKey}
          >
            {days.map((d) => {
              const iso = toIso(d)
              return (
                <button
                  key={iso}
                  type="button"
                  className={[
                    'datefield-day',
                    d.getMonth() === cursor.getMonth() ? '' : 'is-outside',
                    iso === value ? 'is-selected' : '',
                    iso === today ? 'is-today' : '',
                  ].join(' ').trim()}
                  onClick={() => commit(iso)}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>

          <div className="datefield-foot">
            <button type="button" className="btn btn-sm" onClick={() => commit(today)}>
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
