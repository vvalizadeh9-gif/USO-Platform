import { PageHead } from '../components/ui'
import VillageList from './acceptance/VillageList'

/**
 * The contractor's acceptance basket.
 *
 * Scoped by the same rule as every other contractor screen — a contractor sees
 * the villages of the sites assigned to them and nothing else — so this is the
 * same list the coordinator works, filtered by who is asking rather than by a
 * separate query.
 */
export default function MyAcceptance() {
  return (
    <>
      <PageHead
        eyebrow="Field Team"
        title="My Acceptance"
        subtitle="File ICT and CRA letters village by village, and track what came back."
      />
      <VillageList
        canReview={false}
        emptyHint="Villages appear here once their drive test is done."
      />
    </>
  )
}
