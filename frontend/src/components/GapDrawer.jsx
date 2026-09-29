import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'
import { AuthorityChip, EmptyState, SegmentedControl, useDialogFocus } from './ui'
import Waffle from './Waffle'

/**
 * "Who is holding it": a right-side drawer that breaks one figure down by
 * owner.
 *
 * Built for Lifecycle Gaps and kept free of it, so any page with a figure and
 * the owners behind it can use it. The page owns the data and passes it in:
 *
 * * `eyebrow`, `authority`, `title` -- the header (the chip always names the
 *   authority);
 * * `hero` -- { figure, filled, line, note }: the figure (normally an export
 *   button), its waffle squares out of 100, and the lines under it;
 * * `lens`, `lensOptions`, `onLens` -- the "Group by" control. Omit
 *   `lensOptions` to hide it (a scoped viewer has only their own row);
 * * `rows` -- [{ name, count, share, marks, attribution, note, sub }], every
 *   row, in order; `renderCount(row)` draws a row's count (an export button);
 * * `summary` -- the line over the list; `total` -- what the rows must add up
 *   to, checked in `check` ({ ok, text });
 * * `empty` -- { title, hint }: shown instead of the list when there is
 *   nothing to list yet;
 * * `loading` -- the list is being re-read (a new lens): dimmed, busy.
 *
 * A dialog, not a panel: it sits over a scrim, fixed to the viewport, so the
 * page behind never moves or reflows when it opens. Focus moves to Close on
 * open, stays inside while open, and returns to whatever opened it. Esc, ✕
 * and a click on the scrim close it.
 */
export default function GapDrawer({
  open,
  onClose,
  eyebrow,
  authority,
  title,
  hero,
  lens,
  lensOptions,
  onLens,
  rows = [],
  renderCount = (row) => row.count,
  summary,
  shareNote,
  check,
  empty,
  loading = false,
}) {
  const panelRef = useRef(null)
  const titleId = useId()
  useDialogFocus(open, panelRef, onClose)
  if (!open) return null

  return createPortal(
    <>
      <div className="scrim" data-testid="gap-drawer-scrim" onClick={onClose} />
      <motion.aside
        ref={panelRef}
        className="gap-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-authority={authority.toLowerCase()}
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
      >
        <header className="gap-drawer-head">
          <div className="gap-drawer-titles">
            <div className="gap-drawer-eyebrow">{eyebrow}</div>
            <h2 className="gap-drawer-title" id={titleId}>
              <AuthorityChip authority={authority} />
              <span>{title}</span>
            </h2>
          </div>
          <button type="button" className="btn gap-drawer-close" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="gap-drawer-hero">
          <Waffle
            size="hero"
            authority={authority}
            filled={hero.filled}
            empty={hero.empty}
          />
          <div className="gap-drawer-hero-text">
            <div className="gap-drawer-figure">{hero.figure}</div>
            {hero.line && <p className="gap-drawer-line">{hero.line}</p>}
            {hero.note && <p className="gap-drawer-note">{hero.note}</p>}
          </div>
        </div>

        {lensOptions && (
          <SegmentedControl
            label="Group by"
            options={lensOptions}
            value={lens}
            onChange={onLens}
            className="gap-drawer-lenses"
          />
        )}

        {empty ? (
          <div className="gap-drawer-empty">
            <EmptyState title={empty.title} hint={empty.hint} />
          </div>
        ) : (
          <>
            {summary && <p className="gap-drawer-summary">{summary}</p>}
            <div className="gap-drawer-scroll" aria-busy={loading} data-loading={loading || undefined}>
              <table className="gap-drawer-table">
                <thead>
                  <tr>
                    <th scope="col" className="gap-drawer-mark-col">
                      <span className="sr-only">Share mark</span>
                    </th>
                    <th scope="col">Name</th>
                    <th scope="col" className="num">Pending</th>
                    <th scope="col" className="num">Share of gap</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <Row key={`${row.attribution}:${row.name}`} row={row} authority={authority} renderCount={renderCount} />
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="gap-drawer-foot">
              <span>{shareNote}</span>
              {check && (
                <span
                  className={`gap-drawer-check ${check.ok ? '' : 'bad'}`.trim()}
                  data-testid="gap-checksum"
                  role={check.ok ? undefined : 'alert'}
                >
                  {!check.ok && <AlertTriangle size={15} aria-hidden="true" />}
                  {check.text}
                  {check.ok && <span aria-label="checked"> ✓</span>}
                </span>
              )}
            </footer>
          </>
        )}
      </motion.aside>
    </>,
    document.body
  )
}

function Row({ row, authority, renderCount }) {
  const owned = row.attribution === 'owned'
  return (
    <tr className={owned ? undefined : 'is-unowned'}>
      <td className="gap-drawer-mark-col">
        <Waffle size="mark" total={20} columns={20} filled={row.marks} authority={authority} />
      </td>
      <th scope="row" className="gap-drawer-name">
        <span className={owned ? 'text-farsi' : undefined} dir={owned ? 'auto' : undefined} title={row.note}>
          {row.name}
        </span>
        {row.sub && <span className="gap-drawer-sub">{row.sub}</span>}
        {!owned && row.note && <span className="gap-drawer-sub">{row.note}</span>}
      </th>
      <td className="num">{renderCount(row)}</td>
      <td className="num gap-drawer-share">
        {row.share == null ? '—' : `${row.share.toFixed(1)}%`}
      </td>
    </tr>
  )
}
