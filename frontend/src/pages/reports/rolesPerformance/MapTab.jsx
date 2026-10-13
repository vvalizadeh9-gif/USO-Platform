// Map: the Lifecycle Gaps coverage map (same component, same /gaps/map
// endpoint), fitted to the window by the bounded .rp-map column. See UEP-10.
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
