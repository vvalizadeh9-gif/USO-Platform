import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import { FileStack, PanelLeftOpen } from 'lucide-react'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { EmptyState, Loading, PageHead } from '../../components/ui'
import BulkLetterModal from './BulkLetterModal'
import QueuePane from './QueuePane'
import VillagePane from './VillagePane'
import { GROUP_LABEL, REVIEW_ROLES, bucketsFor, errorText } from './status'

const PAGE_SIZE = 50

/**
 * My Work — the acceptance workspace.
 *
 * One screen, two panes: a queue of villages on the left, the village being
 * worked on the right. It replaces a page of tabs that showed status, because
 * status is a reporting question and this is not a reporting screen — status
 * lives in Reports → Acceptance Dashboard.
 *
 * The same component serves a contractor filing letters and a coordinator
 * validating them. Only the buckets and the form differ; the layout is
 * deliberately identical, so someone who does both jobs does not learn two
 * screens.
 */
export default function MyWork() {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const onVillage = useMatch('/my-work/v/:villageId')

  const canReview = REVIEW_ROLES.includes(user?.role?.name)
  const buckets = useMemo(() => bucketsFor(user?.role?.name), [user])

  const [bucket, setBucket] = useState(buckets[0].key)
  // Until someone picks a chip themselves, the page is allowed to open on
  // whichever bucket actually has work in it. Landing on an empty "Needs
  // attention" tells a contractor with forty letters to file that there is
  // nothing to do.
  const [bucketPicked, setBucketPicked] = useState(false)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [list, setList] = useState(null)
  const [counts, setCounts] = useState(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(true)

  const selected = onVillage ? Number(onVillage.params.villageId) : null
  const rows = list?.rows || []

  // Typing filters the whole queue, so it waits for the typing to stop rather
  // than firing a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 250)
    return () => clearTimeout(id)
  }, [search])

  const select = useCallback(
    (id) => navigate(id ? `/my-work/v/${id}` : '/my-work', { replace: !id }),
    [navigate]
  )

  const fetchList = useCallback(
    async (which = bucket, text = query) => {
      const { data } = await api.get('/acceptance/villages', {
        params: { bucket: which, search: text || undefined, limit: PAGE_SIZE },
      })
      setList(data)
      return data
    },
    [bucket, query]
  )

  const fetchCounts = useCallback(async () => {
    const { data } = await api.get('/acceptance/villages/bucket-counts')
    setCounts(data)
    return data
  }, [])

  // Bucket or search changed: reload the queue. The current village is kept
  // if it survived the change, so switching filters does not throw away what
  // is half-typed on the right.
  useEffect(() => {
    let live = true
    setList(null)
    fetchList()
      .then((data) => {
        if (!live) return
        const ids = data.rows.map((r) => r.village_id)
        if (!selected || !ids.includes(selected)) select(ids[0] ?? null)
      })
      .catch(() => live && setList({ total: 0, rows: [] }))
    return () => {
      live = false
    }
    // `selected` is deliberately absent: this runs when the *queue* changes,
    // not when the reader moves down it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, query])

  useEffect(() => {
    fetchCounts()
      .then((data) => {
        if (bucketPicked || (data[bucket] ?? 0) > 0) return
        const first = buckets.find((b) => (data[b.key] ?? 0) > 0)
        if (first) setBucket(first.key)
      })
      .catch(() => setCounts(null))
    // Runs once: after the reader has seen the page, moving it under them
    // would be worse than an empty bucket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Something was filed or decided: refresh both panes and move on.
   *
   * Landing on the next village rather than on what was just finished is the
   * whole point of a queue — the person is here to get through a list, and a
   * screen that stays put makes them find their place again every time.
   */
  const advance = useCallback(
    async (message) => {
      const index = rows.findIndex((r) => r.village_id === selected)
      const preferred =
        rows[index + 1]?.village_id ?? rows[index - 1]?.village_id ?? null

      const [data] = await Promise.all([fetchList(), fetchCounts()])
      const ids = data.rows.map((r) => r.village_id)
      select(ids.includes(preferred) ? preferred : ids[0] ?? null)
      if (message) toast.success(message)
    },
    [rows, selected, fetchList, fetchCounts, select, toast]
  )

  /** Skip: same movement, nothing recorded. */
  const skip = useCallback(() => {
    const index = rows.findIndex((r) => r.village_id === selected)
    const next = rows[index + 1]?.village_id ?? rows[0]?.village_id ?? null
    if (next && next !== selected) select(next)
  }, [rows, selected, select])

  const assigned = counts?.total

  return (
    <>
      <PageHead
        eyebrow="Regulatory"
        title="My Work"
        subtitle={
          canReview
            ? `Validate ICT and CRA letters, one village at a time.${
                assigned != null ? ` ${assigned} in your scope.` : ''
              }`
            : `File ICT and CRA letters, one village at a time.${
                assigned != null ? ` ${assigned} assigned to you.` : ''
              }`
        }
        actions={
          <button className="btn btn-primary" onClick={() => setBulkOpen(true)}>
            <FileStack size={15} /> One letter, many villages
          </button>
        }
      />

      <button
        className="btn btn-sm queue-toggle mb-16"
        onClick={() => setQueueOpen((open) => !open)}
        aria-expanded={queueOpen}
      >
        <PanelLeftOpen size={14} /> Queue{list ? ` (${list.total})` : ''}
      </button>

      <div className="mywork">
        <QueuePane
          collapsed={!queueOpen}
          buckets={buckets}
          bucket={bucket}
          counts={counts}
          onBucket={(key) => {
            setBucketPicked(true)
            setBucket(key)
          }}
          search={search}
          onSearch={setSearch}
          rows={rows}
          loading={list === null}
          selected={selected}
          onSelect={select}
        />

        {list === null ? (
          <div className="card">
            <Loading label="Loading your queue" />
          </div>
        ) : selected ? (
          <VillagePane
            key={selected}
            villageId={selected}
            canReview={canReview}
            onDone={advance}
            onSkip={skip}
            onError={(err, fallback) => toast.error(errorText(err, fallback))}
          />
        ) : (
          <CaughtUp
            bucket={bucket}
            buckets={buckets}
            counts={counts}
            onBucket={(key) => {
              setBucketPicked(true)
              setBucket(key)
            }}
          />
        )}
      </div>

      {bulkOpen && (
        <BulkLetterModal
          onClose={() => setBulkOpen(false)}
          onDone={(message) => {
            setBulkOpen(false)
            advance(message)
          }}
        />
      )}
    </>
  )
}

/** Nothing left in this bucket — say so, and offer the ones that have work. */
function CaughtUp({ bucket, buckets, counts, onBucket }) {
  const elsewhere = buckets.filter((b) => b.key !== bucket && (counts?.[b.key] ?? 0) > 0)
  return (
    <div className="card card-pad">
      <EmptyState
        title="You're all caught up in this bucket"
        hint={`Nothing is in ${GROUP_LABEL[bucket]?.toLowerCase() || 'this bucket'} right now.`}
      />
      {elsewhere.length > 0 && (
        <div className="row" style={{ gap: 8, justifyContent: 'center', paddingBottom: 24 }}>
          {elsewhere.map((b) => (
            <button key={b.key} className="btn btn-sm" onClick={() => onBucket(b.key)}>
              {b.label} ({counts[b.key]})
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
