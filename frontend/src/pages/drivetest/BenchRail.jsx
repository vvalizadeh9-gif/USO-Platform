import { useSectionSpy } from './useSectionSpy'

/**
 * The bench rail: where the panels are, and where you are among them.
 *
 * The dashboard carries seven panels and around three screens of scroll. Read
 * once, top to bottom, that is fine. Worked with — which is what this page is
 * for, since every figure on it is a link into the queue — it means scrolling
 * past four panels to re-check a fifth, with nothing on screen saying how far
 * down you are or what is left.
 *
 * So the rail lists the panels, carries each one's headline figure beside it,
 * and marks the one being read. The figure is the point as much as the link
 * is: a contents list that only names its sections makes you jump to a panel
 * to find out whether it was worth jumping to.
 *
 * It is a nav, not a toolbar. Anything that CHANGES what the page shows
 * belongs in the command bar above; the rail only moves you around what is
 * already there.
 */
export default function BenchRail({ items }) {
  const active = useSectionSpy(items.map((i) => i.id))

  if (items.length === 0) return null

  return (
    <nav className="dt-rail" aria-label="Dashboard panels">
      <span className="dt-rail-cap">Panels</span>
      <ul>
        {items.map((item) => {
          const current = active === item.id
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className={`dt-rail-link${current ? ' dt-rail-current' : ''}`}
                // The rail marks position; it does not claim to be the page's
                // current *route*. aria-current="true" says "this one of the
                // set", which is exactly the claim.
                aria-current={current ? 'true' : undefined}
              >
                <span className="dt-rail-tick" aria-hidden="true" />
                <span className="dt-rail-name">{item.label}</span>
                {item.figure != null && (
                  <span className="dt-rail-figure tnum" style={{ color: item.color }}>
                    {item.figure}
                  </span>
                )}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
