// Acceptance › Filing (UEP-22): a focus inbox of acceptance cases.
//
// Three columns -- the inbox, the update panel, the history -- for one
// authority at a time (ICT | CRA). Every number, state and permission comes
// from the server (services/acceptance_cases); the page reads, words and
// sends. State lives in the URL (?authority, tab, village, q, basket, bucket)
// so Baskets and Home can link straight into a filtered inbox.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageFrame from '../../components/PageFrame'
import { SegmentedControl } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { useHomeData } from '../../shell/HomeData'
import { usePageCrumb } from '../../shell/crumbs'
import * as api from './api'
import HistoryPanel from './HistoryPanel'
import Inbox from './Inbox'
import { ChangeBasket, StatusBoxes, UpdateCard, VillageBlock } from './UpdatePanel'
import {
  AUTHORITIES,
  flatRows,
  isTyping,
  nextVillage,
  otherAuthority,
  stepVillage,
} from './filingModel'
import '../../styles/work.css'
import '../../styles/filing.css'

const message = (err, fallback) => err?.response?.data?.detail?.message || fallback

function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const seq = useRef(0)
  const load = useCallback(() => {
    const mine = ++seq.current
    setState((s) => ({ ...s, loading: true, error: null }))
    return fn()
      .then((data) => { if (mine === seq.current) setState({ data, error: null, loading: false }) })
      .catch((err) => { if (mine === seq.current) setState((s) => ({ ...s, error: message(err, 'Could not load'), loading: false })) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { load() }, [load])
  return [state, load]
}

function useDebounced(value, ms) {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return out
}

export default function FilingPage() {
  usePageCrumb('Filing')
  const toast = useToast()
  const home = useHomeData()
  const [params, setParams] = useSearchParams()
  const authority = AUTHORITIES.includes((params.get('authority') || '').toUpperCase())
    ? params.get('authority').toUpperCase() : 'ICT'
  const tab = params.get('tab') || 'all'
  const basket = params.get('basket') || ''
  const bucket = params.get('bucket') || ''
  const selectedParam = Number(params.get('village')) || null
  const [query, setQuery] = useState(params.get('q') || '')
  const q = useDebounced(query, 250)
  const [ticked, setTicked] = useState(() => new Set())
  const [saving, setSaving] = useState(false)
  const card = useRef(null)

  const setParam = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '') next.delete(k)
        else next.set(k, String(v))
      }
      return next
    }, { replace: true })
  }, [setParams])

  const [inboxState, reloadInbox] = useLoad(
    () => api.fetchInbox({ authority, tab, q: q || undefined, basket: basket || undefined, bucket: bucket || undefined }),
    [authority, tab, q, basket, bucket],
  )
  const inbox = inboxState.data
  const rows = useMemo(() => flatRows(inbox), [inbox])
  const selectedId = selectedParam || rows[0]?.village_id || null

  const [caseState, reloadCase] = useLoad(
    () => (selectedId ? api.fetchCase(selectedId, authority) : Promise.resolve(null)),
    [selectedId, authority],
  )
  const [historyState, reloadHistory] = useLoad(
    () => (selectedId ? api.fetchHistory(selectedId, authority) : Promise.resolve(null)),
    [selectedId, authority],
  )
  const [catState] = useLoad(() => api.fetchCategories(), [])

  // A change of authority, tab or search starts a fresh selection of ticks.
  useEffect(() => { setTicked(new Set()) }, [authority, tab, q, basket, bucket])

  const select = useCallback((id) => setParam({ village: id }), [setParam])
  const switchAuthority = useCallback((auth) => setParam({ authority: auth }), [setParam])
  const tick = useCallback((id) => setTicked((s) => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }), [])

  const onSaved = useCallback(async (body) => {
    const out = await api.saveUpdate(body)
    const name = caseState.data?.village?.name || caseState.data?.village?.code || 'village'
    const many = body.village_ids.length > 1
    toast.success(many ? `Saved · ${body.village_ids.length} villages` : `Saved · ${name}`,
      out.in_validation?.length ? `Sent to ${body.authority} validation` : undefined)
    const following = many ? null : nextVillage(rows, selectedId)
    setTicked(new Set())
    await reloadInbox()
    home?.reload?.()
    if (following && following !== selectedId) select(following)
    else { reloadCase(); reloadHistory() }
    return out
  }, [caseState.data, toast, rows, selectedId, reloadInbox, reloadCase, reloadHistory, home, select])

  const onBasket = useCallback(async (caseId, body) => {
    await api.changeBasket(caseId, body)
    toast.success('Basket changed')
    await reloadInbox()
    reloadCase()
    reloadHistory()
    home?.reload?.()
  }, [toast, reloadInbox, reloadCase, reloadHistory, home])

  // J/K move · W/A/R choose · Ctrl Enter save
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        card.current?.save()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      const key = e.key.toLowerCase()
      if (key === 'j' || key === 'k') {
        const id = stepVillage(rows, selectedId, key === 'j' ? 1 : -1)
        if (id) select(id)
      } else if (key === 'w') card.current?.choose('waiting')
      else if (key === 'a') card.current?.choose('approved')
      else if (key === 'r') card.current?.choose('rejected')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, selectedId, select])

  const detail = caseState.data
  const current = detail?.boxes?.[0]
  const can = inbox?.can
  const targets = ticked.size ? [...ticked] : (selectedId ? [selectedId] : [])
  const filterLabel = basket || bucket ? `Filtered from Baskets${bucket ? ` · ${bucket.replace('_', ' ')}` : ''}` : null

  return (
    <PageFrame
      className="fl-page"
      bar={(
        <div className="fl-bar">
          <SegmentedControl
            label="Authority"
            className="fl-seg"
            options={AUTHORITIES.map((a) => ({ key: a, label: a }))}
            value={authority}
            onChange={switchAuthority}
          />
        </div>
      )}
    >
      <div className="fl-grid">
        <Inbox
          authority={authority}
          inbox={inbox}
          error={inboxState.error}
          loading={inboxState.loading}
          tab={tab}
          onTab={(t) => setParam({ tab: t === 'all' ? null : t, village: null })}
          query={query}
          onQuery={(v) => { setQuery(v); setParam({ q: v || null, village: null }) }}
          selectedId={selectedId}
          onSelect={select}
          ticked={ticked}
          onTick={tick}
          canTick={Boolean(can && !can.read_only)}
          onRetry={reloadInbox}
          filterLabel={filterLabel}
          onClearFilter={() => setParam({ basket: null, bucket: null })}
        />
        <section className="fl-update" aria-label="Update" aria-busy={saving || undefined}>
          {caseState.error && (
            <div className="fl-error" role="alert">
              <span>{caseState.error}</span>
              <button type="button" className="uw-btn uw-btn-sm" onClick={reloadCase}>Retry</button>
            </div>
          )}
          {!selectedId && inbox && <p className="fl-muted">Pick a village from the inbox.</p>}
          {selectedId && !detail && !caseState.error && <div className="fl-skeleton is-update" aria-hidden="true"><span className="fl-skel-row" /><span className="fl-skel-box" /></div>}
          {detail && (
            <>
              <VillageBlock village={detail.village} />
              <StatusBoxes boxes={detail.boxes} onOpenOther={() => switchAuthority(otherAuthority(authority))} />
              {current?.state === 'rejected' && can?.change_basket && (
                <ChangeBasket key={`${current.case_id}-${current.basket_key}`} box={current}
                  categories={catState.data || []} onChange={onBasket} />
              )}
              {current && current.state !== 'approved' && can && (
                <UpdateCard
                  key={`${selectedId}-${authority}-${current.state}-${ticked.size > 0}`}
                  ref={card}
                  authority={authority}
                  state={current.state}
                  can={can}
                  categories={catState.data || []}
                  contractor={detail.village.contractor}
                  targets={targets}
                  title={ticked.size ? `Update ${ticked.size} villages` : `Update ${authority}`}
                  onSaved={onSaved}
                  onSaving={setSaving}
                />
              )}
            </>
          )}
        </section>
        <HistoryPanel
          authority={authority}
          history={selectedId ? historyState.data : null}
          error={historyState.error}
          onRetry={reloadHistory}
        />
      </div>
    </PageFrame>
  )
}
