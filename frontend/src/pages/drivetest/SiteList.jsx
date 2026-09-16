import { Download, ExternalLink, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api from '../../api/client'
import { describeBlobError, filenameFrom, saveBlob } from '../../lib/download'
import SiteHistoryDrawer, { SiteCodeButton } from '../../components/SiteHistoryDrawer'
import { EmptyState, Loading, PageHead } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { BUCKET_LABEL, PAGE_SIZE, UNATTRIBUTED } from './constants'
import { count } from './format'

/**
 * The sites behind one figure on the Drive Test dashboard.
 *
 * The dashboard could say there were 64 problematic sites on temporary power
 * and offer no way to reach any of them. This is that way: a list whose length
 * is the number that was clicked, which is the only property that makes the
 * link worth having. It is asserted on the server, in the parity test.
 *
 * Every filter lives in the query string and nowhere else. A narrowed list is
 * therefore a link somebody can send, the back button steps through the
 * narrowing, and the pills below the title are rendered from what the server
 * says it applied rather than from what this component believes it asked for —
 * so a filter the server ignored could not look applied here.
 */

/** Which filters make sense for which figure.
 *
 * Only these are offered, and the endpoint refuses the rest with a 422 rather
 * than ignoring them: an age band on a Done list would ask how long a
 * finished thing has been unfinished.
 *
 * Two figures age, on two different clocks. An ongoing site is aged from the
 * day a contractor was given it; a problematic one from the day it last
 * entered the state. They share one parameter and one set of bands, and the
 * endpoint picks the clock from the bucket — see `_age_clock` in
 * `services/dt_site_list.py`.
 */
const FILTERS_FOR_BUCKET = {
  onair: ['province_id', 'contractor_id'],
  done: ['province_id', 'contractor_id'],
  ongoing: ['province_id', 'contractor_id', 'age_band', 'stage'],
  problematic: ['province_id', 'contractor_id', 'category', 'age_band', 'overdue'],
  remaining: ['province_id', 'contractor_id'],
  delivered: ['province_id', 'contractor_id'],
}

/** Every parameter this page carries in the URL, so one place knows them all. */
const FILTER_PARAMS = [
  'bucket',
  'category',
  'age_band',
  'stage',
  'contractor_id',
  'province_id',
  'year',
  'month',
  'overdue',
  'owner_role_id',
  'sort',
]

const SHAMSI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
]

/** The columns, in the order the export writes them.
 *
 * `sort` is the key the endpoint's whitelist knows this column by; a column
 * without one is not sortable, which is deliberate for the list-valued ones —
 * there is no single value to order a site by.
 */
const COLUMNS = [
  { key: 'site_code', label: 'Site ID', sort: 'site_code' },
  { key: 'villages', label: 'Villages', farsi: true },
  { key: 'province', label: 'Province', sort: 'province', farsi: true },
  { key: 'contractor', label: 'Contractor', sort: 'contractor', farsi: true },
  { key: 'bucket', label: 'Bucket', sort: 'bucket' },
  { key: 'current_stage', label: 'Stage', sort: 'current_stage' },
  { key: 'launch_date', label: 'Launch date', sort: 'launch_date', numeric: true },
  { key: 'days_since_launch', label: 'Days since launch', sort: 'days_since_launch', numeric: true },
  { key: 'age_band', label: 'Waiting' },
  // The question this screen exists to answer for a problematic site, and the
  // one somebody gets asked about by name. Sortable, because the reader's
  // first move is to put the worst offenders at the top.
  {
    key: 'days_problematic',
    label: 'Problem for (days)',
    sort: 'days_problematic',
    numeric: true,
  },
  { key: 'problematic_since', label: 'Problem since', numeric: true },
  { key: 'problem_categories', label: 'Problem categories' },
  { key: 'fix_owners', label: 'Fix owners' },
  {
    key: 'oldest_open_fix_days',
    label: 'Oldest open fix',
    sort: 'oldest_open_fix_days',
    numeric: true,
    hint: 'Days since the current fix opened. A re-routed fix restarts its clock.',
  },
  { key: 'max_days_late', label: 'Days late', sort: 'max_days_late', numeric: true },
  { key: 'hc_round', label: 'HC round', sort: 'hc_round', numeric: true },
  { key: 'dt_execution_date', label: 'DT execution date', sort: 'dt_execution_date', numeric: true },
  { key: 'dt_approved_at', label: 'DT approved', sort: 'dt_approved_at', numeric: true },
  { key: 'dt_evidence_count', label: 'Evidence', sort: 'dt_evidence_count', numeric: true },
]

/** A dash, never a zero.
 *
 * "No open fix" and "open nought days" are different facts, and a column of
 * zeros reads as the second where the first is true.
 */
function cell(value) {
  if (value == null || value === '' || value === 0) return '—'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  return value
}

export default function SiteList() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const toast = useToast()
  const isContractor = user?.role?.name === 'Contractor'

  const [state, setState] = useState({ data: null, error: null, loading: true })
  const [history, setHistory] = useState({ id: null, code: null })
  const [exporting, setExporting] = useState(false)
  const [provinces, setProvinces] = useState([])
  const [contractors, setContractors] = useState([])
  const [categories, setCategories] = useState([])

  const bucket = searchParams.get('bucket') || 'onair'
  const offset = Number(searchParams.get('offset') || 0) || 0
  const sort = searchParams.get('sort') || ''

  // The query the endpoint is asked, and the query string the export button
  // repeats: one object, so the file can never describe a different list.
  const query = useMemo(() => {
    const out = {}
    for (const name of FILTER_PARAMS) {
      const value = searchParams.get(name)
      if (value != null && value !== '') out[name] = value
    }
    out.bucket = bucket
    return out
  }, [searchParams, bucket])

  useEffect(() => {
    let active = true
    setState((s) => ({ ...s, loading: true }))
    api
      .get('/drive-test/sites', { params: { ...query, limit: PAGE_SIZE, offset } })
      .then((r) => active && setState({ data: r.data, error: null, loading: false }))
      .catch((err) => {
        if (!active) return
        const detail = err.response?.data?.detail
        setState({
          data: null,
          loading: false,
          error:
            typeof detail === 'string'
              ? detail
              : 'Could not load these sites. Please try again.',
        })
      })
    return () => {
      active = false
    }
  }, [query, offset])

  useEffect(() => {
    api.get('/reference/provinces').then((r) => setProvinces(r.data)).catch(() => {})
    api.get('/reference/problem-categories').then((r) => setCategories(r.data)).catch(() => {})
    // A contractor account is forced to its own company by the endpoint, and
    // naming the others in a dropdown on their screen would hand them a list
    // of their competitors — which is exactly what the dashboard's ongoing
    // breakdown is careful not to do.
    if (!isContractor) {
      api.get('/reference/contractors').then((r) => setContractors(r.data)).catch(() => {})
    }
  }, [isContractor])

  /** Change one filter, and go back to the first page.
   *
   * Staying on page four of a list that has just been narrowed to twelve rows
   * shows an empty table and looks like a broken filter.
   */
  const setFilter = useCallback(
    (name, value) => {
      const next = new URLSearchParams(searchParams)
      if (value == null || value === '') next.delete(name)
      else next.set(name, String(value))
      next.delete('offset')
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  const setBucket = useCallback(
    (next) => {
      // The filters that do not apply to the new figure go with it, rather
      // than travelling along and earning a 422.
      const params = new URLSearchParams(searchParams)
      params.set('bucket', next)
      const allowed = new Set(FILTERS_FOR_BUCKET[next] || [])
      for (const name of ['category', 'age_band', 'stage', 'overdue']) {
        if (!allowed.has(name)) params.delete(name)
      }
      params.delete('offset')
      setSearchParams(params)
    },
    [searchParams, setSearchParams],
  )

  const setPage = useCallback(
    (nextOffset) => {
      const params = new URLSearchParams(searchParams)
      if (nextOffset > 0) params.set('offset', String(nextOffset))
      else params.delete('offset')
      setSearchParams(params)
    },
    [searchParams, setSearchParams],
  )

  const toggleSort = useCallback(
    (key) => {
      const current = sort
      setFilter('sort', current === key ? `-${key}` : current === `-${key}` ? '' : key)
    },
    [sort, setFilter],
  )

  async function exportList() {
    setExporting(true)
    try {
      const res = await api.get('/drive-test/sites/export', {
        params: query,
        responseType: 'blob',
      })
      saveBlob(res.data, filenameFrom(res.headers, `drive-test-${bucket}.xlsx`))
    } catch (err) {
      // The reason the server gave, read back out of the blob the failure
      // arrived as -- see `lib/download`.
      toast.error('Export failed', await describeBlobError(err))
    } finally {
      setExporting(false)
    }
  }

  const data = state.data
  // Memoised: two useMemos below depend on it, and a fresh {} every render
  // would rebuild both every render.
  const applied = useMemo(() => data?.filters_applied ?? {}, [data])
  const total = data?.total ?? 0
  const rows = data?.rows ?? []

  /* The band and stage vocabularies come from the response, not from a copy
     kept here. This screen used to hold its own transcription of them, and it
     went stale the first time the bands were re-cut: the dropdown offered
     keys the endpoint no longer accepted, so every option in it answered 422.
     A control built from what the request itself returned cannot drift from
     what the next request will accept. */
  const ageBands = useMemo(() => data?.age_bands ?? [], [data])
  const ongoingStages = useMemo(() => data?.ongoing_stages ?? [], [data])

  const names = useMemo(
    () => ({
      province: Object.fromEntries((provinces || []).map((p) => [String(p.id), p.name])),
      contractor: Object.fromEntries((contractors || []).map((c) => [String(c.id), c.name])),
      ageBand: Object.fromEntries(ageBands.map((b) => [b.key, b.label])),
    }),
    [provinces, contractors, ageBands],
  )

  const describe = useCallback(
    (name, value) => {
      if (name === 'province_id') return names.province[value] || `Province ${value}`
      if (name === 'contractor_id') {
        return value === UNATTRIBUTED
          ? 'No contractor'
          : names.contractor[value] || `Contractor ${value}`
      }
      if (name === 'age_band') return names.ageBand[value] || value
      if (name === 'month') return SHAMSI_MONTHS[Number(value) - 1] || value
      if (name === 'overdue') return 'Overdue fixes only'
      return value
    },
    [names],
  )

  // The title names the figure back to the reader in the words the dashboard
  // used, with the one filter that made it specific beside it.
  const qualifier = applied.category || (applied.age_band && names.ageBand[applied.age_band])
    || applied.stage || null
  const title = state.loading && !data
    ? `${BUCKET_LABEL[bucket] ?? 'sites'}`
    : `${count(total)} ${BUCKET_LABEL[bucket] ?? 'sites'}${qualifier ? ` · ${qualifier}` : ''}`

  const scope = useMemo(() => {
    const parts = []
    if (applied.province_id) parts.push(describe('province_id', applied.province_id))
    if (applied.contractor_id) parts.push(describe('contractor_id', applied.contractor_id))
    if (applied.year && applied.month) {
      parts.push(`${describe('month', applied.month)} ${applied.year}`)
    }
    return parts.length ? parts.join(' · ') : 'Across everything you can see'
  }, [applied, describe])

  const pills = FILTER_PARAMS.filter((name) => name !== 'bucket' && name !== 'sort')
    .filter((name) => applied[name] != null)
    .map((name) => ({ name, label: describe(name, applied[name]) }))

  const options = new Set(FILTERS_FOR_BUCKET[bucket] || [])

  return (
    <>
      <PageHead
        eyebrow="Drive Test Project"
        title={title}
        subtitle={scope}
        actions={
          <button
            className="btn"
            onClick={exportList}
            disabled={exporting || !rows.length}
            title="Download this list as an Excel file"
          >
            {exporting ? <div className="spinner" /> : <><Download size={15} /> Export this list</>}
          </button>
        }
      />

      <div className="card card-pad mb-16 row wrap" style={{ gap: 10, alignItems: 'center' }}>
        <Select
          label="Figure"
          value={bucket}
          onChange={setBucket}
          options={Object.entries(BUCKET_LABEL).map(([key, label]) => ({ value: key, label }))}
        />
        {options.has('province_id') && (
          <Select
            label="Province"
            value={searchParams.get('province_id') || ''}
            onChange={(v) => setFilter('province_id', v)}
            placeholder="All provinces"
            options={provinces.map((p) => ({ value: String(p.id), label: p.name }))}
          />
        )}
        {options.has('contractor_id') && !isContractor && (
          <Select
            label="Contractor"
            value={searchParams.get('contractor_id') || ''}
            onChange={(v) => setFilter('contractor_id', v)}
            placeholder="All contractors"
            options={[
              { value: UNATTRIBUTED, label: 'No contractor' },
              ...contractors.map((c) => ({ value: String(c.id), label: c.name })),
            ]}
          />
        )}
        {options.has('category') && (
          <Select
            label="Category"
            value={searchParams.get('category') || ''}
            onChange={(v) => setFilter('category', v)}
            placeholder="All categories"
            options={[
              ...categories.map((c) => ({ value: c.name, label: c.name })),
              { value: 'Uncategorized', label: 'Uncategorized' },
            ]}
          />
        )}
        {options.has('age_band') && (
          <Select
            /* One parameter, two clocks, so the control is named after the
               one it is measuring here: an ongoing site is waiting to be
               driven, a problematic one is stuck. Calling both "Waiting"
               would say a blocked site is queued. */
            label={bucket === 'problematic' ? 'Stuck for' : 'Waiting'}
            value={searchParams.get('age_band') || ''}
            onChange={(v) => setFilter('age_band', v)}
            placeholder="Any age"
            options={ageBands.map((b) => ({ value: b.key, label: b.label }))}
          />
        )}
        {options.has('stage') && (
          <Select
            label="Stage"
            value={searchParams.get('stage') || ''}
            onChange={(v) => setFilter('stage', v)}
            placeholder="Any stage"
            options={ongoingStages.map((o) => ({ value: o.key, label: o.label }))}
          />
        )}
        {options.has('overdue') && (
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={searchParams.get('overdue') === 'true'}
              onChange={(e) => setFilter('overdue', e.target.checked ? 'true' : '')}
            />
            Overdue fixes only
          </label>
        )}
      </div>

      {pills.length > 0 && (
        <div className="row wrap mb-16" style={{ gap: 8 }} aria-label="Active filters">
          {pills.map((pill) => (
            <button
              key={pill.name}
              type="button"
              className="pill pill-dim"
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => setFilter(pill.name, '')}
              aria-label={`Remove filter ${pill.label}`}
            >
              {pill.label} <X size={11} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {state.error ? (
        <div className="card card-pad" role="alert">
          <b>Could not show these sites.</b>
          <p>{state.error}</p>
        </div>
      ) : state.loading && !data ? (
        <Loading label="Loading sites" />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No sites match these filters"
            hint="Remove a filter above, or pick a different figure."
          />
        </div>
      ) : (
        <>
          <div className="table-wrap scroll-x">
            <table>
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      style={{ textAlign: col.numeric ? 'right' : 'left' }}
                      aria-sort={
                        sort === col.sort ? 'ascending'
                          : sort === `-${col.sort}` ? 'descending'
                          : 'none'
                      }
                    >
                      {col.sort ? (
                        <button
                          type="button"
                          className="dt-sort-btn"
                          onClick={() => toggleSort(col.sort)}
                          title={col.hint}
                        >
                          {col.label}
                        </button>
                      ) : (
                        <span title={col.hint}>{col.label}</span>
                      )}
                    </th>
                  ))}
                  <th scope="col" className="dt-col-action">
                    <span className="dt-sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.work_item_id}>
                    {COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className={[
                          col.farsi ? 'dt-farsi' : '',
                          col.numeric ? 'tnum' : '',
                        ].join(' ').trim() || undefined}
                        style={col.numeric ? { textAlign: 'right' } : undefined}
                        title={
                          col.key === 'oldest_open_fix_days' && row.oldest_open_fix_days == null
                            ? 'Flagged by CPM import; no in-app fix to date from.'
                            : undefined
                        }
                      >
                        {col.key === 'site_code' ? (
                          <SiteCodeButton
                            workItemId={row.work_item_id}
                            siteCode={row.site_code}
                            onOpen={(id, code) => setHistory({ id, code })}
                          />
                        ) : (
                          cell(row[col.key])
                        )}
                      </td>
                    ))}
                    <td className="dt-col-action">
                      <Link
                        to={`/work-items/${row.work_item_id}`}
                        aria-label={`Open work item ${row.site_code || row.work_item_id}`}
                      >
                        <ExternalLink size={14} aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row between wrap mt-16" style={{ gap: 12, alignItems: 'center' }}>
            <span className="muted tnum">
              Showing {count(offset + 1)}–{count(Math.min(offset + rows.length, total))} of{' '}
              {count(total)}
            </span>
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn-sm"
                disabled={offset === 0}
                onClick={() => setPage(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </button>
              <button
                className="btn btn-sm"
                disabled={offset + rows.length >= total}
                onClick={() => setPage(offset + PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      <SiteHistoryDrawer
        workItemId={history.id}
        siteCode={history.code}
        onClose={() => setHistory({ id: null, code: null })}
      />
    </>
  )
}

function Select({ label, value, onChange, options, placeholder }) {
  return (
    <label className="row" style={{ gap: 6, alignItems: 'center' }}>
      <span className="muted">{label}</span>
      <select
        className="input"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
