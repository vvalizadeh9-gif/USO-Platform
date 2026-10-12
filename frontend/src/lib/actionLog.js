// Your recent actions on the work pages, each undoable for two minutes
// (UEP-06 §6).
//
// One store for both pages, so an assignment made on Health check is still in
// History after moving to Drive test. Kept for the browser session (the
// server's two-minute window is the real limit; this list is only how you
// reach it). The server decides whether an undo is still allowed.
import { useSyncExternalStore } from 'react'

export const UNDO_WINDOW_MS = 2 * 60 * 1000
const KEY = 'uep.work.actions'
const MAX = 30

/** @typedef {{ id: string, label: string, at: number, undoUrl: string, status: 'open'|'undone'|'refused' }} LoggedAction */

function read() {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

let actions = read()
const listeners = new Set()

function write(next) {
  actions = next
  try {
    sessionStorage.setItem(KEY, JSON.stringify(actions))
  } catch {
    // Private mode or a full store: the list still works for this page.
  }
  listeners.forEach((l) => l())
}

let seq = 0

/** Record an action; returns its id. */
export function logAction({ label, undoUrl }, now = Date.now()) {
  const id = `${now}-${++seq}`
  write([{ id, label, at: now, undoUrl, status: 'open' }, ...actions].slice(0, MAX))
  return id
}

export function markAction(id, status) {
  write(actions.map((a) => (a.id === id ? { ...a, status } : a)))
}

/** Seconds of undo left, 0 once the window has passed. */
export function secondsLeft(action, now = Date.now()) {
  return Math.max(0, Math.ceil((action.at + UNDO_WINDOW_MS - now) / 1000))
}

export function canUndo(action, now = Date.now()) {
  return action.status === 'open' && secondsLeft(action, now) > 0
}

export function useActionLog() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => actions,
  )
}

/** For tests. */
export function clearActionLog() {
  write([])
}
