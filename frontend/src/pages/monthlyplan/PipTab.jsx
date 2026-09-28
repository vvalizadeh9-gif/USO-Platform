import { Loading } from '../../components/ui'
import StreamPanel from './StreamPanel'
import { STREAM_META } from './streams'

/**
 * The PIP vs Achieved tab: GET /pip/overview drawn as the DT Delivery and
 * Acceptance panels, one above the other. The read itself is the page's
 * (useOverview), because the month picker's day line comes from it too.
 */
export default function PipTab({ data, failed, view, period, canSetTarget, onTargetSaved, onOpen }) {
  if (failed) {
    return <div className="card"><div className="empty">Could not load the monthly plan.</div></div>
  }
  if (!data) return <Loading label="Loading the monthly plan" />

  const last = data.months[data.months.length - 1]
  return (
    <div className="mp-stack">
      {['dt', 'acceptance'].map((key) => (
        <StreamPanel
          key={key}
          meta={STREAM_META[key]}
          data={data[key]}
          view={view}
          period={period}
          canSetTarget={canSetTarget}
          onTargetSaved={onTargetSaved}
          onOpen={(row) =>
            onOpen({
              contractorId: row.contractor_id,
              name: row.name,
              stream: STREAM_META[key].stream,
              year: last.shamsi_year,
              month: last.shamsi_month,
            })
          }
        />
      ))}
    </div>
  )
}
