import { useLayoutEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon'
import { Fa, StepError } from '../../components/work/parts'
import { formatNumber } from '../../lib/numbers'
import { typeLabel } from './listModel'
import ProvinceMap from './ProvinceMap'
import VillageChip from './VillageChip'

/**
 * How many chips fit on two lines, leaving room for "+n more". Measured after
 * each layout: everything is drawn first, then the overflow is cut.
 */
function useTwoLineFit(listRef, count) {
  const [shown, setShown] = useState(count)
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    const fit = () => {
      const items = [...list.children].filter((el) => !el.dataset.more)
      if (items.length === 0) return
      const tops = [...new Set(items.map((el) => el.offsetTop))].sort((a, b) => a - b)
      const limit = tops[1] ?? tops[0]
      const inside = items.filter((el) => el.offsetTop <= limit).length
      setShown(inside >= count ? count : Math.max(1, inside - 1))
    }
    setShown(count)
    const frame = requestAnimationFrame(fit)
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(frame)
    // On resize: everything back, then cut again once it is drawn.
    const observer = new ResizeObserver(() => {
      setShown(count)
      requestAnimationFrame(() => requestAnimationFrame(fit))
    })
    observer.observe(list.parentElement)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [listRef, count])
  return shown
}

function Villages({ villages, changes, started, highlight, onHighlight, onHistory }) {
  const listRef = useRef(null)
  const shown = useTwoLineFit(listRef, villages.length)
  const more = villages.length - shown
  return (
    <div className="exp-cell exp-villages">
      <div className="exp-cell-head">
        <h3 className="exp-title">
          Target villages <span className="exp-count uw-num">{formatNumber(villages.length)}</span>
        </h3>
        <button type="button" className="exp-history" onClick={onHistory} data-history-trigger>
          <Icon name="recently-viewed" size={16} />
          {changes > 0 ? `History · ${formatNumber(changes)} ${changes === 1 ? 'change' : 'changes'}` : 'History'}
        </button>
      </div>
      {villages.length === 0 ? (
        <span className="exp-none">No target villages</span>
      ) : (
        <ul className="exp-chips" ref={listRef} aria-label="Target villages">
          {villages.slice(0, shown).map((v, i) => (
            <li key={v.id ?? v.code} style={{ '--exp-i': i }}>
              <VillageChip
                village={v}
                pressed={highlight === v.code}
                disabled={!started}
                onClick={() => onHighlight(highlight === v.code ? null : v.code)}
              />
            </li>
          ))}
          {more > 0 && (
            <li data-more="true" style={{ '--exp-i': shown }}>
              <button type="button" className="exv is-button is-more" onClick={onHistory}>+{more} more</button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/** A contractor: a grey icon tile (tower or car), then name over role. */
function ContractorRow({ icon, name, role }) {
  return (
    <div className="exp-contractor">
      <span className="exp-contractor-tile"><Icon name={icon} size={16} /></span>
      <span className="exp-contractor-text">
        {name ? <Fa className="exp-contractor-name">{name}</Fa> : <span className="exp-contractor-name is-none">Not assigned</span>}
        <span className="exp-role">{role}</span>
      </span>
    </div>
  )
}

/** The passport's final-size placeholders. */
function PassportSkeleton() {
  return (
    <>
      <div className="exp-location"><span className="h-skel exp-skel-map" /><span className="h-skel exp-skel-line" /></div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="exp-cell"><span className="h-skel exp-skel-line" /><span className="h-skel exp-skel-block" /></div>
      ))}
    </>
  )
}

/**
 * The site passport (UEP-28 §B2), replacing General information: where the
 * site is, its target villages, its type and requested technology, and its
 * two contractors. On air and DT dates live on the journey ribbon instead.
 */
export default function SitePassport({ record, status, onRetry, highlight, onHighlight, onHistory }) {
  const g = record?.general
  return (
    <section className="hw-card exp" aria-labelledby="exp-heading" aria-busy={status === 'loading' || undefined}>
      <h2 id="exp-heading" className="uw-sr-only">Site passport</h2>
      {status === 'error' ? (
        <div className="exp-error"><StepError stepName="the site passport" onRetry={onRetry} /></div>
      ) : !g ? (
        <PassportSkeleton />
      ) : (
        <>
          <div className="exp-location">
            <ProvinceMap province={g.province} />
            <div className="exp-location-text">
              <h3 className="uw-sr-only">Province</h3>
              <span className="exp-province">{g.province ? <Fa>{g.province}</Fa> : '—'}</span>
            </div>
          </div>
          <Villages
            villages={record.villages}
            changes={record.village_history?.length || 0}
            started={record.acceptance_started}
            highlight={highlight}
            onHighlight={onHighlight}
            onHistory={onHistory}
          />
          <div className="exp-cell exp-type">
            <div className="exp-group">
              <h3 className="exp-title">Site type</h3>
              <span className="exp-value">{typeLabel(g.site_type) || '—'}</span>
            </div>
            <div className="exp-group">
              <h3 className="exp-title">Technology</h3>
              {g.requested_technology?.length ? (
                <span className="exp-techs" role="group" aria-label={`Requested technology: ${g.requested_technology.join(', ')}`}>
                  {g.requested_technology.map((t) => <span key={t} className="exp-tech">{t}</span>)}
                </span>
              ) : <span className="exp-none">—</span>}
            </div>
          </div>
          <div className="exp-cell exp-contractors">
            <h3 className="exp-title">Contractors</h3>
            <div className="exp-contractor-rows">
              <ContractorRow icon="cell-tower" name={g.site_contractor} role="Site contractor" />
              <ContractorRow icon="car" name={g.dt_contractor} role="DT contractor" />
            </div>
          </div>
        </>
      )}
    </section>
  )
}
