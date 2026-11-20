// The page's figures (GET /submissions/summary): tiles, cycle, owner, Mojri.
import { useCallback, useEffect, useState } from 'react'
import { detailMessage } from '../../lib/apiError'
import * as api from './api'

export function useSummary() {
  const [state, setState] = useState({ summary: null, error: '' })
  const load = useCallback(() => {
    api.fetchSummary()
      .then((summary) => setState({ summary, error: '' }))
      .catch((err) => setState((s) => ({ ...s, error: detailMessage(err, 'The figures did not load.') })))
  }, [])
  useEffect(load, [load])
  return { ...state, load }
}
