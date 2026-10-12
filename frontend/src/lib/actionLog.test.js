import { beforeEach, describe, expect, it } from 'vitest'
import { UNDO_WINDOW_MS, canUndo, clearActionLog, logAction, markAction, secondsLeft, useActionLog } from './actionLog'
import { renderHook } from '@testing-library/react'

beforeEach(clearActionLog)

describe('the action log', () => {
  it('lists the newest action first, undoable for two minutes', () => {
    const t = 1_000_000
    logAction({ label: 'first', undoUrl: '/a' }, t)
    logAction({ label: 'second', undoUrl: '/b' }, t + 1000)
    const { result } = renderHook(() => useActionLog())
    const [newest] = result.current
    expect(result.current.map((a) => a.label)).toEqual(['second', 'first'])
    expect(secondsLeft(newest, t + 1000)).toBe(120)
    expect(secondsLeft(newest, t + 1000 + UNDO_WINDOW_MS - 500)).toBe(1)
    expect(canUndo(newest, t + 1000 + UNDO_WINDOW_MS)).toBe(false)
  })

  it('cannot undo what was already undone', () => {
    const id = logAction({ label: 'x', undoUrl: '/x' })
    markAction(id, 'undone')
    const { result } = renderHook(() => useActionLog())
    expect(canUndo(result.current[0])).toBe(false)
  })
})
