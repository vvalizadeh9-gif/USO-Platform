import { beforeEach, describe, expect, it } from 'vitest'
import { logAction } from './actionLog'
import { lastListSearch, rememberList } from '../pages/explorer/listModel'
import { resetClientSession } from './session'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('resetClientSession', () => {
  it('removes every uep key in both stores', () => {
    sessionStorage.setItem('uep.lastApp', 'explorer')
    localStorage.setItem('uep_user', '{"username":"sara"}')
    localStorage.setItem('uep.validation.view.1', 'site')
    resetClientSession()
    expect(sessionStorage.getItem('uep.lastApp')).toBeNull()
    expect(localStorage.getItem('uep_user')).toBeNull()
    expect(localStorage.getItem('uep.validation.view.1')).toBeNull()
  })

  it('keeps the remembered username, the motion override and keys that are not ours', () => {
    localStorage.setItem('uep_remembered_username', 'sara')
    localStorage.setItem('uep_motion', 'reduce')
    localStorage.setItem('other', 'x')
    resetClientSession()
    expect(localStorage.getItem('uep_remembered_username')).toBe('sara')
    expect(localStorage.getItem('uep_motion')).toBe('reduce')
    expect(localStorage.getItem('other')).toBe('x')
  })

  it('forgets the action log and the last list, which also live in memory', () => {
    logAction({ label: 'Assigned', undoUrl: '/undo/1' })
    rememberList('?q=12', { pages: [], scrollTop: 0 })
    resetClientSession()
    expect(sessionStorage.getItem('uep.work.actions')).toBeNull()
    expect(lastListSearch()).toBe('')
  })
})
