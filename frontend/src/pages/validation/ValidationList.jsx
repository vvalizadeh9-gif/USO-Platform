import Icon from '../../components/Icon'
import LetterDate from '../../components/LetterDate'
import { SegmentedControl } from '../../components/ui'
import { formatNumber } from '../../lib/numbers'
import { VIEW_LETTER, VIEW_SITE } from './useValidation'

const other = (authority) => (authority === 'ICT' ? 'CRA' : 'ICT')
const plural = (n, word) => `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`

/**
 * The left list (UEP-16 §3): By letter | By site, a search, and one row per
 * letter or site, longest waiting first. No actions here: a row opens its
 * group on the right.
 */
export default function ValidationList({
  authority, view, onView, counts, groups, selectedKey, onSelect, query, onQuery, loading, empty,
}) {
  const options = [
    { key: VIEW_LETTER, label: <>By letter <span className="vl-seg-count">{formatNumber(counts?.letter ?? 0)}</span></> },
    { key: VIEW_SITE, label: <>By site <span className="vl-seg-count">{formatNumber(counts?.site ?? 0)}</span></> },
  ]
  return (
    <nav className="vl-list" aria-label={`${authority} ${view === VIEW_LETTER ? 'letters' : 'sites'}`}>
      <div className="vl-list-head">
        <SegmentedControl options={options} value={view} onChange={onView} label="Group filings" className="vl-seg" />
        <label className="vl-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Letter, site, village or contractor"
            aria-label="Search letter number, site ID, village ID or contractor"
          />
        </label>
      </div>
      <div className="vl-list-body">
        {loading ? (
          <ul className="vl-rows" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="vl-row vl-skel-row"><span className="vl-skel" /><span className="vl-skel is-short" /></li>
            ))}
          </ul>
        ) : groups.length === 0 ? (
          empty
        ) : (
          <ul className="vl-rows">
            {groups.map((g) => (
              <li key={g.key}>
                <button
                  type="button"
                  className={`vl-row ${g.key === selectedKey ? 'is-selected' : ''}`.trim()}
                  aria-current={g.key === selectedKey ? 'true' : undefined}
                  onClick={() => onSelect(g.key)}
                >
                  <span className="vl-row-main">
                    <span className="vl-row-title" dir="ltr">{g.label}</span>
                    <span className="vl-row-meta">
                      {view === VIEW_LETTER ? (
                        <>
                          <bdi dir="rtl" lang="fa" className="vl-fa">{g.contractor?.name || '—'}</bdi>
                          {' · '}<LetterDate shamsi={g.letter_date_shamsi} iso={g.letter_date} />
                          {' · '}{plural(g.villages, 'village')}
                        </>
                      ) : (
                        <>
                          <bdi dir="rtl" lang="fa" className="vl-fa">{g.province || '—'}</bdi>
                          {' · '}<bdi dir="rtl" lang="fa" className="vl-fa">{g.contractor?.name || '—'}</bdi>
                          {' · '}{plural(g.letters, 'letter')}
                          {' · '}{plural(g.villages, 'village')}
                        </>
                      )}
                      {g.rejected > 0 && <span className="vl-bad">{' · '}{formatNumber(g.rejected)} rejected</span>}
                      {view === VIEW_SITE && g.other_waiting > 0 && (
                        <span className={`vl-other is-${other(authority).toLowerCase()}`}>
                          {' · '}+{formatNumber(g.other_waiting)} {other(authority)}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="vl-row-side">
                    <span className="vl-days tnum">{formatNumber(g.waiting_days)} d</span>
                    {g.late && <span className="vl-late">late</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  )
}
