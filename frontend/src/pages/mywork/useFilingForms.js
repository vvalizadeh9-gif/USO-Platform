// The ICT and CRA forms, side by side and independent: sending one never
// touches the other. The letter (number, date, scan) survives moving to the
// next village -- one letter is routinely filed village by village -- while
// the per-village verdicts and the "tried" state start over.
import { useMemo, useReducer } from 'react'

export const blankLetter = () => ({ number: '', date: '', scan: null })

const blankSide = () => ({
  letter: blankLetter(),
  verdicts: {},     // { [villageId]: { [tech]: { result, reason } } }
  rejections: [],   // many villages: [{ villageId, techs: [], reason }]
  picking: false,
  tried: false,
  server: null,     // the server's refusal, mapped by validation.serverErrors
})

const initial = () => ({ ICT: blankSide(), CRA: blankSide() })

function patchSide(state, authority, patch) {
  return { ...state, [authority]: { ...state[authority], ...patch } }
}

function reducer(state, action) {
  const side = state[action.authority]
  switch (action.type) {
    case 'letter':
      return patchSide(state, action.authority, { letter: { ...side.letter, ...action.patch }, server: null })
    case 'verdict': {
      const village = side.verdicts[action.villageId] || {}
      const current = village[action.tech] || { result: 'approved', reason: '' }
      return patchSide(state, action.authority, {
        verdicts: {
          ...side.verdicts,
          [action.villageId]: { ...village, [action.tech]: { ...current, ...action.patch } },
        },
      })
    }
    case 'picking':
      return patchSide(state, action.authority, { picking: action.value })
    case 'addRejection':
      return patchSide(state, action.authority, {
        picking: false,
        rejections: [...side.rejections, { villageId: action.villageId, techs: [action.tech], reason: '' }],
      })
    case 'rejection':
      return patchSide(state, action.authority, {
        rejections: side.rejections.map((r, i) => (i === action.index ? { ...r, ...action.patch } : r)),
      })
    case 'removeRejection':
      return patchSide(state, action.authority, {
        rejections: side.rejections.filter((_r, i) => i !== action.index),
      })
    case 'tried':
      return patchSide(state, action.authority, { tried: action.value })
    case 'server':
      return patchSide(state, action.authority, { server: action.server, tried: true })
    case 'clear':
      return { ...state, [action.authority]: blankSide() }
    case 'restore':
      return { ...state, [action.authority]: action.snapshot }
    case 'newSelection':
      return {
        ICT: { ...blankSide(), letter: state.ICT.letter },
        CRA: { ...blankSide(), letter: state.CRA.letter },
      }
    default:
      return state
  }
}

export function useFilingForms() {
  const [forms, dispatch] = useReducer(reducer, undefined, initial)
  // One object for the component's life, so effects can depend on it.
  const actions = useMemo(() => ({
    letter: (authority, patch) => dispatch({ type: 'letter', authority, patch }),
    verdict: (authority, villageId, tech, patch) => dispatch({ type: 'verdict', authority, villageId, tech, patch }),
    picking: (authority, value) => dispatch({ type: 'picking', authority, value }),
    addRejection: (authority, villageId, tech) => dispatch({ type: 'addRejection', authority, villageId, tech }),
    rejection: (authority, index, patch) => dispatch({ type: 'rejection', authority, index, patch }),
    removeRejection: (authority, index) => dispatch({ type: 'removeRejection', authority, index }),
    tried: (authority, value) => dispatch({ type: 'tried', authority, value }),
    server: (authority, server) => dispatch({ type: 'server', authority, server }),
    clear: (authority) => dispatch({ type: 'clear', authority }),
    restore: (authority, snapshot) => dispatch({ type: 'restore', authority, snapshot }),
    newSelection: () => dispatch({ type: 'newSelection' }),
  }), [])
  return [forms, actions]
}

/** One village's claims for one side, from the form: every tech it must
 * file, Approved unless marked Rejected. */
export function claimsFor(villageVerdicts, toFile) {
  return toFile.map((tech) => {
    const v = villageVerdicts?.[tech]
    const rejected = v?.result === 'rejected'
    return { tech, result: rejected ? 'rejected' : 'approved', ...(rejected ? { reason: (v.reason || '').trim() } : {}) }
  })
}

/** The many-villages form's claims: approved unless a rejection row names it. */
export function claimsFromRejections(row, authority, rejections) {
  const toFile = row.sides[authority].to_file
  const rejection = rejections.find((r) => r.villageId === row.village_id)
  return toFile.map((tech) => {
    const rejected = rejection?.techs.includes(tech)
    return { tech, result: rejected ? 'rejected' : 'approved', ...(rejected ? { reason: rejection.reason.trim() } : {}) }
  })
}
