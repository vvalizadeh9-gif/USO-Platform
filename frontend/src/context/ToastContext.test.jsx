// A toast's dismiss timer must not outlive its provider. It used to: a page
// test that raised a toast and finished inside four seconds left the timer
// running, and when it fired the test DOM was already gone -- "window is not
// defined" after every test had passed, failing CI on timing alone.
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider, useToast } from './ToastContext'

function Raise() {
  const toast = useToast()
  return <button onClick={() => toast.success('Saved')}>raise</button>
}

// The animation library schedules timers of its own, so these tests follow
// the dismiss timers -- the ones set for the toast's duration -- by id.
function dismissTimers() {
  const set = vi.spyOn(globalThis, 'setTimeout')
  const clear = vi.spyOn(globalThis, 'clearTimeout')
  return {
    ids: () =>
      set.mock.calls
        .map((call, i) => (call[1] === 4000 ? set.mock.results[i].value : null))
        .filter((id) => id !== null),
    cleared: () => clear.mock.calls.map((call) => call[0]),
  }
}

describe('ToastProvider', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('clears pending dismiss timers on unmount', () => {
    const timers = dismissTimers()
    const { unmount } = render(<ToastProvider><Raise /></ToastProvider>)
    act(() => screen.getByText('raise').click())
    act(() => screen.getByText('raise').click())
    const pending = timers.ids()
    expect(pending).toHaveLength(2)
    unmount()
    expect(timers.cleared()).toEqual(expect.arrayContaining(pending))
  })
})
