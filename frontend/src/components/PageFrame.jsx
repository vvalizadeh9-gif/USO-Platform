import { createContext, useContext, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFillPage } from './pageMode'

const DockSlotContext = createContext(null)

/**
 * A one-screen page: a fixed header (`bar`, normally a `<PageBar>`), then a
 * body that fills the rest of the height and never scrolls itself. Anything
 * long scrolls inside its own card (`.card-fill` > `.table-scroll`).
 *
 * Under the body is the dock slot: a full-width row pinned to the bottom of
 * the main column. A tab puts its assignment dock there with `<PageDock>`, so
 * the dock is part of the layout -- never inside the table, never fixed over
 * the content -- while the tab that owns the selection still renders it.
 *
 * Rendering this puts the shell in fill mode (see pageMode.js); a page that
 * does not render it keeps the ordinary scrolling frame.
 */
export default function PageFrame({ bar, className = '', children }) {
  useFillPage()
  const [slot, setSlot] = useState(null)
  return (
    <div className={`page-frame ${className}`.trim()}>
      {bar}
      <DockSlotContext.Provider value={slot}>
        <div className="page-body">{children}</div>
      </DockSlotContext.Provider>
      <div className="page-dock" ref={setSlot} />
    </div>
  )
}

/** Render `children` into the page's dock slot. Outside a PageFrame (a tab
 * rendered on its own, as in a unit test) it renders in place. */
export function PageDock({ children }) {
  const slot = useContext(DockSlotContext)
  return slot ? createPortal(children, slot) : children
}
