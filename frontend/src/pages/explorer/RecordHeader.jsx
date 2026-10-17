import { Link } from 'react-router-dom'
import Icon from '../../components/Icon'
import { myWorkPath } from '../../lib/explorerLinks'
import { usePageCrumb } from '../../shell/crumbs'
import { openVillages, siteBadge } from './explorerModel'

/**
 * The header row (UEP-11 §B3; the breadcrumb is the shell's, UEP-13 §3.12): the site ID with its one
 * status badge, and nothing under it. Actions on the right: Take action (only
 * with an action to take), Open in My Work, and File letter for the roles that
 * file, while the site has open villages.
 */
export default function RecordHeader({ record, siteLabel, headingRef, canFile, isContractor, onTakeAction }) {
  const badge = record ? siteBadge(record.status) : null
  const site = record?.site_code
  const openCount = record ? openVillages(record.villages).length : 0
  // The breadcrumb lives in the header only: UEP / Explorer / W4303.
  usePageCrumb(siteLabel)
  return (
    <>
      <div className="ex-header">
        <h1 ref={headingRef} tabIndex={-1}>{siteLabel}</h1>
        {badge && (
          <span className={`ex-badge is-${badge.tone}`}>
            <Icon name={badge.tone === 'done' ? 'checkmark--filled' : 'time'} size={16} />
            {badge.label}
          </span>
        )}
        <span className="ex-header-spacer" />
        {record && onTakeAction && (
          <button type="button" className="uw-btn" onClick={onTakeAction}>
            <Icon name="tools" size={16} /> Take action
          </button>
        )}
        {site && (
          <Link className="uw-btn" to={myWorkPath({ q: site })}>
            <Icon name="arrow--right" size={16} /> Open in My Work
          </Link>
        )}
        {site && canFile && record.acceptance_started && openCount > 0 && (
          <Link className="uw-btn uw-btn-primary" to={myWorkPath({ q: site, tab: isContractor ? 'your_move' : 'all' })}>
            <Icon name="document" size={16} /> File letter
          </Link>
        )}
      </div>
    </>
  )
}
