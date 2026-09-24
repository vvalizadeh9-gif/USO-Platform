import { Info } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

/**
 * The note behind a card's info icon: its caveats and its counting method.
 *
 * WHY NOT A CSS :hover TOOLTIP, which is what the agreed layout was drawn
 * with. Hover does not exist on a touch screen, so on a tablet every footnote
 * moved behind one of these icons -- a scale that does not start at zero, a
 * count that is derived rather than measured -- would simply never be
 * readable. This is a toggletip instead: a click or tap pins it open, Enter
 * or Space does the same from the keyboard (it is a real button), Escape or a
 * press anywhere else closes it. A mouse still gets it on hover, as a
 * convenience on top rather than the only way in.
 *
 * Hover is honoured for a mouse pointer only. A tap fires emulated pointer
 * events too, and letting those count as hover left the note stuck open after
 * a second tap meant to close it.
 *
 * The note is in the DOM whether or not it is showing, and the button names
 * it with `aria-describedby`, so a screen reader announces it with the button
 * rather than depending on the reader finding an overlay.
 *
 * It anchors to the card header, not to the icon: a card in the narrow
 * right-hand column cannot then push the note off the edge of the page.
 */
export default function InfoTip({ label, children }) {
  const id = useId()
  const ref = useRef(null)
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const open = pinned || hovered

  useEffect(() => {
    if (!pinned) return undefined
    const away = (event) => {
      if (!ref.current?.contains(event.target)) setPinned(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [pinned])

  return (
    <span
      className="dt-info"
      ref={ref}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setPinned(false)
          setHovered(false)
        }
      }}
    >
      <button
        type="button"
        className="dt-info-btn"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={id}
        onClick={() => setPinned((p) => !p)}
      >
        <Info size={13} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <span id={id} role="note" className="dt-info-tip" hidden={!open}>
        {children}
      </span>
    </span>
  )
}
