import { describe, expect, it, vi } from 'vitest'
import { ACTIVITY_EVENTS, REFRESH_EVERY_MS, startKeepAlive } from './sessionKeepAlive'

function setup() {
  const target = new EventTarget()
  const refresh = vi.fn()
  let clock = 1_000_000
  const stop = startKeepAlive({ refresh, now: () => clock, target })
  return {
    target,
    refresh,
    stop,
    advance: (ms) => {
      clock += ms
    },
    act: (name = 'pointerdown') => target.dispatchEvent(new Event(name)),
  }
}

describe('startKeepAlive', () => {
  it('renews on the first activity, without waiting out a throttle', () => {
    const { act, refresh } = setup()
    act()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does nothing until somebody does something', () => {
    const { advance, refresh } = setup()
    advance(60 * 60 * 1000)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('renews at most once per interval, however busy the person is', () => {
    const { act, advance, refresh } = setup()
    for (let i = 0; i < 50; i++) {
      act('keydown')
      advance(1000)
    }
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('renews again once the interval has passed', () => {
    const { act, advance, refresh } = setup()
    act()
    advance(REFRESH_EVERY_MS - 1)
    act()
    expect(refresh).toHaveBeenCalledTimes(1)
    advance(1)
    act()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it.each(ACTIVITY_EVENTS)('hears %s as activity', (name) => {
    const { act, refresh } = setup()
    act(name)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not count events that are not a person (a mouse move, a timer)', () => {
    const { act, refresh } = setup()
    act('mousemove')
    act('focus')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('stops listening when stopped', () => {
    const { act, stop, refresh } = setup()
    stop()
    act()
    expect(refresh).not.toHaveBeenCalled()
  })
})
