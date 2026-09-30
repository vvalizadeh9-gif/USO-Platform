import { AuthorityChip } from './ui'
import Waffle from './Waffle'

/**
 * One gap as a selectable tile: the authority chip and label, a 10x10 waffle
 * of the gap against its base, the figure, and two lines saying what the
 * squares are.
 *
 * Two things to click, never one inside the other:
 *
 * * the tile -- a stretched `<button>` under everything -- opens whatever the
 *   tile is about (`onOpen`);
 * * the figure -- passed in as `figure`, normally an `<ExportNumber>` -- sits
 *   above the stretched button and does its own thing (export).
 *
 * Everything else in the tile lets clicks through to the stretched button.
 *
 * `share` is the line under the figure: the gap's share of its base, "13%".
 * `scale`, when given, is one more quiet line under it (e.g. "Nothing
 * counted yet" for a base of 0). What the share is a share of belongs in
 * `openLabel`, which screen readers announce.
 *
 * `breakdown`, when given, is one more short line under those: what the
 * figure is made of (the Mojri tiles say how many are in Mojri, need a look
 * and are missing). One line, so the page still fits without scrolling.
 *
 * `selected` draws the Cobalt selected state while whatever the tile opened
 * is open. `empty` is the "no data yet" state: a dotted grid, the figure
 * reads "—", and `emptyNote` / `emptyFigure` explain why.
 */
export default function WaffleTile({
  authority,
  label,
  filled,
  figure,
  share,
  scale,
  breakdown,
  selected = false,
  empty = false,
  emptyNote,
  emptyFigure,
  openLabel,
  onOpen,
}) {
  return (
    <div
      className="waffle-tile"
      data-authority={authority.toLowerCase()}
      data-selected={selected || undefined}
      data-testid="waffle-tile"
    >
      <button
        type="button"
        className="waffle-tile-hit"
        aria-label={openLabel}
        aria-haspopup="dialog"
        aria-expanded={selected}
        onClick={onOpen}
      />
      <div className="waffle-tile-head">
        <AuthorityChip authority={authority} />
        <span className="waffle-tile-label">{label}</span>
      </div>
      <Waffle
        filled={empty ? 0 : filled}
        authority={authority}
        empty={empty}
        className="waffle-tile-grid"
      />
      <div className="waffle-tile-figure">
        {empty ? <span className="waffle-tile-none">—</span> : figure}
      </div>
      {empty ? (
        <>
          <p className="waffle-tile-line">{emptyNote}</p>
          {emptyFigure && <p className="waffle-tile-line waffle-tile-live">{emptyFigure}</p>}
        </>
      ) : (
        <>
          <p className="waffle-tile-line" data-testid="waffle-share">{share}</p>
          {scale && <p className="waffle-tile-line waffle-tile-scale">{scale}</p>}
          {breakdown && (
            <p className="waffle-tile-line waffle-tile-scale" data-testid="waffle-breakdown">
              {breakdown}
            </p>
          )}
        </>
      )}
    </div>
  )
}
