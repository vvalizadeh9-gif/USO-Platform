// The stepper: a click moves by one, holding repeats, and letting go adds no
// extra click. There is no typing, and zero is the floor.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Stepper from './Stepper'

function Harness({ start = 10, min = 0 }) {
  const [value, setValue] = useState(start)
  return <Stepper value={value} onChange={setValue} min={min} label="DT delivery, Alpha" />
}
const value = () => screen.getByRole('status', { name: 'DT delivery, Alpha' })
const press = (name) => screen.getByRole('button', { name })

describe('Stepper', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('moves by one on a click, from the mouse or the keyboard', () => {
    render(<Harness />)
    fireEvent.click(press('Increase'), { detail: 1 })
    fireEvent.click(press('Increase'))
    fireEvent.click(press('Decrease'), { detail: 1 })
    expect(value()).toHaveTextContent('11')
  })

  it('names the number and has no field to type in', () => {
    render(<Harness />)
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('stops at zero', () => {
    render(<Harness start={1} />)
    fireEvent.click(press('Decrease'))
    expect(value()).toHaveTextContent('0')
    expect(press('Decrease')).toBeDisabled()
  })

  it('repeats while held: nothing before 400 ms, then +1 every 110 ms for 12 ticks, then +5 every 60 ms', () => {
    render(<Harness />)
    fireEvent.pointerDown(press('Increase'))
    act(() => vi.advanceTimersByTime(399))
    expect(value()).toHaveTextContent('10')
    act(() => vi.advanceTimersByTime(1))
    expect(value()).toHaveTextContent('11')
    act(() => vi.advanceTimersByTime(110 * 11))
    expect(value()).toHaveTextContent('22')
    act(() => vi.advanceTimersByTime(60))
    expect(value()).toHaveTextContent('27')
    act(() => vi.advanceTimersByTime(60 * 2))
    expect(value()).toHaveTextContent('37')
  })

  it('adds no extra click when the button is released after a hold', () => {
    render(<Harness />)
    fireEvent.pointerDown(press('Increase'))
    act(() => vi.advanceTimersByTime(400 + 110 * 2))
    expect(value()).toHaveTextContent('13')
    fireEvent.pointerUp(press('Increase'))
    fireEvent.click(press('Increase'), { detail: 1 })
    expect(value()).toHaveTextContent('13')
    act(() => vi.advanceTimersByTime(2000))
    expect(value()).toHaveTextContent('13')
    // The next press is a press again.
    fireEvent.click(press('Increase'), { detail: 1 })
    expect(value()).toHaveTextContent('14')
  })

  it('counts down to zero while held, and stops repeating when the pointer leaves', () => {
    render(<Harness start={14} />)
    fireEvent.pointerDown(press('Decrease'))
    act(() => vi.advanceTimersByTime(400 + 110 * 11))
    expect(value()).toHaveTextContent('2')
    act(() => vi.advanceTimersByTime(110))
    expect(value()).toHaveTextContent('0')
    act(() => vi.advanceTimersByTime(1000))
    expect(value()).toHaveTextContent('0')

    fireEvent.pointerDown(press('Increase'))
    act(() => vi.advanceTimersByTime(400))
    fireEvent.pointerLeave(press('Increase'))
    act(() => vi.advanceTimersByTime(1000))
    expect(value()).toHaveTextContent('1')
  })
})
