// Map: the Lifecycle Gaps coverage map, embedded exactly as it is (same
// component, same /gaps/map endpoint, same styling). Nothing here changes it.
import CoverageMap from '../CoverageMap'
import PerfHeader from './PerfHeader'

export default function MapTab({ search }) {
  return (
    <>
      <PerfHeader tab="map" scopeLabel="Coverage" title="Map" search={search} />
      <div className="rp-body rp-map">
        <CoverageMap />
      </div>
    </>
  )
}
