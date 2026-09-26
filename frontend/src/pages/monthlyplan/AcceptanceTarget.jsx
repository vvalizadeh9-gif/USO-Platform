import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client'
import AcceptanceTargetCard from './AcceptanceTargetCard'

/**
 * The acceptance target's place on the Monthly Plan page: it loads the plan
 * and re-reads it after a PM saves, so the card shows what was just set.
 *
 * Nothing is shown until the plan has loaded, and nothing if it cannot be:
 * a failed read is not the same as "not set yet", and the card would say the
 * second when only the first is known.
 */
export default function AcceptanceTarget() {
  const [plan, setPlan] = useState(null)

  const load = useCallback(() => {
    api
      .get('/acceptance/plan')
      .then((r) => setPlan(r.data))
      .catch(() => setPlan(null))
  }, [])
  useEffect(load, [load])

  if (!plan) return null
  return (
    <section className="acc-plan-row" aria-label="Acceptance target">
      <AcceptanceTargetCard plan={plan} onSaved={load} />
    </section>
  )
}
