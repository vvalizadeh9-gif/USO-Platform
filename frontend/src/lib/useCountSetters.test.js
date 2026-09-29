import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import useCountSetters from './useCountSetters'

describe('useCountSetters', () => {
  it('gives the same setter for a key on every render', () => {
    const { result, rerender } = renderHook(() => {
      const [counts, setCounts] = useState({})
      return { counts, setCount: useCountSetters(setCounts) }
    })
    const first = result.current.setCount('pool')
    act(() => first(4))
    rerender()
    expect(result.current.setCount('pool')).toBe(first)
    expect(result.current.counts).toEqual({ pool: 4 })
  })

  it('does not replace the counts when a value is unchanged', () => {
    const { result } = renderHook(() => {
      const [counts, setCounts] = useState({ pool: 4 })
      return { counts, setCount: useCountSetters(setCounts) }
    })
    const before = result.current.counts
    act(() => result.current.setCount('pool')(4))
    expect(result.current.counts).toBe(before)
  })
})
