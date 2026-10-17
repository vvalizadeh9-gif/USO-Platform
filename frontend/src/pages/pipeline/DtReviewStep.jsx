import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import ReviewPanel from '../../components/work/ReviewPanel'
import { ConfirmDialog } from '../../components/ui'
import {
  EmptyStep, Fa, SearchBox, SkeletonRows, StepError, ToolSelect, WaitingCell, WorkListCard,
} from '../../components/work/parts'
import { useWork } from '../../components/work/WorkContext'
import { useToast } from '../../context/ToastContext'
import { saveBlob } from '../../lib/download'
import DateText from '../../components/DateText'
import useStepData, { useExportRows } from './useStepData'

const EXPORT_COLUMNS = [
  { label: 'Site ID', value: (r) => r.site_code },
  { label: 'Province', value: (r) => r.province },
  { label: 'Contractor', value: (r) => r.contractor_name },
  { label: 'Carried out', value: (r) => r.execution_date },
  { label: 'Files', value: (r) => r.evidence.length },
  { label: 'Waiting (days)', value: (r) => r.days_waiting },
]

/** Waiting days, most first; a row with no clock goes last. */
// eslint-disable-next-line react-refresh/only-export-components -- tested on its own
export function byLongestWaiting(a, b) {
  return (b.days_waiting ?? -1) - (a.days_waiting ?? -1)
}

const filesLabel = (n) => `${n} ${n === 1 ? 'file' : 'files'}`

/**
 * Step 6 (UEP-06 §5.2): submitted drive tests, the list on the left and the
 * open one in the panel on the right. J and K move through the list while
 * focus is in it -- never from anywhere else on the page (WCAG 2.1.4). After
 * a decision the next row opens. Approving is final: it marks the site DT
 * Done, so both decisions keep their confirmation dialogs.
 */
export default function DtReviewStep({ step, figures, panelProps, onExport }) {
  const toast = useToast()
  const { confirmAction } = useWork()
  const { rows, error, retry } = useStepData('/hc/queues/dt-review')
  const [query, setQuery] = useState('')
  const [province, setProvince] = useState('')
  const [contractor, setContractor] = useState('')
  const [openId, setOpenId] = useState(null)
  const [comments, setComments] = useState({})
  const [checkedOutside, setCheckedOutside] = useState({})
  const [pending, setPending] = useState(null) // decision awaiting its dialog
  const [busy, setBusy] = useState(null)
  const slaDays = figures?.sla_days

  const options = (key) => [...new Set((rows || []).map((r) => r[key]).filter(Boolean))].sort()
  const shown = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    return rows
      .filter(
        (r) =>
          (!province || r.province === province) &&
          (!contractor || r.contractor_name === contractor) &&
          (!q || (r.site_code || '').toLowerCase().includes(q)),
      )
      .sort(byLongestWaiting)
  }, [rows, query, province, contractor])
  useExportRows(onExport, EXPORT_COLUMNS, rows ? shown : null)

  // The open row: the one picked, else the first. Kept open across reloads
  // while it is still in the list.
  const current = shown.find((r) => r.drive_test_id === openId) || shown[0] || null
  useEffect(() => {
    if (current && current.drive_test_id !== openId) setOpenId(current.drive_test_id)
  }, [current, openId])

  const move = (delta) => {
    const i = shown.findIndex((r) => r.drive_test_id === current?.drive_test_id)
    const next = shown[Math.min(shown.length - 1, Math.max(0, i + delta))]
    if (!next) return
    setOpenId(next.drive_test_id)
    document.getElementById(`dt-review-${next.drive_test_id}`)?.focus()
  }
  const onListKey = (e) => {
    if (e.target.closest('input, textarea, select')) return
    if (e.key === 'j' || e.key === 'J') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'k' || e.key === 'K') {
      e.preventDefault()
      move(-1)
    }
  }

  async function decide() {
    const row = current
    const decision = pending
    setBusy(decision)
    try {
      await api.post(`/drive-tests/${row.drive_test_id}/coordinator-review`, {
        decision,
        comment: comments[row.drive_test_id] || null,
        ...(decision === 'Approved' && row.evidence.length === 0 && checkedOutside[row.drive_test_id]
          ? { report_checked_outside: true }
          : {}),
      })
      setPending(null)
      // The next row opens: the one after this in the list.
      const i = shown.findIndex((r) => r.drive_test_id === row.drive_test_id)
      setOpenId(shown[i + 1]?.drive_test_id ?? shown[i - 1]?.drive_test_id ?? null)
      confirmAction({
        text:
          decision === 'Approved'
            ? `✓ ${row.site_code} approved. It now counts as drive-test done.`
            : `✓ ${row.site_code} sent back to its contractor.`,
      })
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function download(evidence) {
    try {
      const res = await api.get(`/drive-tests/evidence/${evidence.id}/download`, { responseType: 'blob' })
      saveBlob(res.data, evidence.original_filename)
    } catch {
      toast.error('Download failed', 'The stored file could not be read.')
    }
  }

  return (
    <div className="uw-review-layout">
      <WorkListCard
        {...panelProps}
        busy={!rows && !error}
        tools={
          <>
            <SearchBox value={query} onChange={setQuery} />
            <ToolSelect label="Province" value={province} onChange={setProvince} options={options('province')} allLabel="All provinces" />
            <ToolSelect label="Contractor" value={contractor} onChange={setContractor} options={options('contractor_name')} allLabel="All contractors" />
          </>
        }
        description="Sorted: longest waiting first"
      >
        {error && !rows ? (
          <StepError stepName={step.name} onRetry={retry} />
        ) : rows && rows.length === 0 ? (
          <EmptyStep stepName={step.name} />
        ) : (
          // The list is where J and K work; the handler is on it alone.
          <div className="uw-review-list" onKeyDown={onListKey}>
            <table className="uw-table" aria-label={step.name}>
              <colgroup>
                <col style={{ width: '16%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '12%' }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Site ID</th>
                  <th scope="col">Province</th>
                  <th scope="col">Contractor</th>
                  <th scope="col">Carried out</th>
                  <th scope="col">Files</th>
                  <th scope="col">Waiting · SLA {slaDays ?? '–'} d</th>
                </tr>
              </thead>
              {!rows ? (
                <SkeletonRows columns={6} />
              ) : (
                <tbody>
                  {shown.map((r) => {
                    const isOpen = r.drive_test_id === current?.drive_test_id
                    return (
                      <tr key={r.drive_test_id} className={isOpen ? 'is-open' : undefined}>
                        <td>
                          <button
                            id={`dt-review-${r.drive_test_id}`}
                            type="button"
                            className="uw-site-id"
                            aria-current={isOpen ? 'true' : undefined}
                            onClick={() => setOpenId(r.drive_test_id)}
                          >
                            {r.site_code}
                          </button>
                        </td>
                        <td><Fa>{r.province}</Fa></td>
                        <td><Fa>{r.contractor_name}</Fa></td>
                        <td className="uw-num"><DateText value={r.execution_date} /></td>
                        <td className="uw-num">
                          {r.evidence.length ? (
                            filesLabel(r.evidence.length)
                          ) : (
                            <span className="uw-chip-neutral">No report</span>
                          )}
                        </td>
                        <td><WaitingCell days={r.days_waiting} slaDays={slaDays} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              )}
            </table>
          </div>
        )}
      </WorkListCard>
      <div className="uw-review-side">
        <ReviewPanel
          row={current}
          slaDays={slaDays}
          comment={current ? comments[current.drive_test_id] : ''}
          onComment={(text) => setComments((c) => ({ ...c, [current.drive_test_id]: text }))}
          checkedOutside={current ? Boolean(checkedOutside[current.drive_test_id]) : false}
          onCheckedOutside={(value) => setCheckedOutside((c) => ({ ...c, [current.drive_test_id]: value }))}
          onDecide={setPending}
          onDownload={download}
          busy={busy}
        />
        {current && <p className="uw-keys">In the list: <kbd>J</kbd> <kbd>K</kbd></p>}
      </div>
      <ConfirmDialog
        open={pending !== null}
        title={pending === 'Approved' ? 'Approve this drive test?' : 'Send this drive test back?'}
        message={
          pending === 'Approved'
            ? 'This completes the drive test for the site. It is marked DT Done, counted on the dashboard, and its villages become submittable for acceptance. There is no further approval.'
            : 'The contractor is notified and can resubmit. The site returns to their queue.'
        }
        confirmLabel={pending === 'Approved' ? 'Yes, approve' : 'Yes, send it back'}
        danger={pending !== 'Approved'}
        busy={busy != null}
        onConfirm={decide}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
