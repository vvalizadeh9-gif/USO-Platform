import { Fa } from '../../components/work/parts'

/**
 * One village as a chip: its Persian name (Vazirmatn 14/600) and its ID
 * (12, monospaced digits). The list's villages strip, the record's passport
 * and the history panel all use it, so a village looks the same everywhere.
 * With `onClick` it is a button (`pressed` marks the highlighted one).
 */
export default function VillageChip({ village, onClick, pressed, disabled, struck, className = '', style }) {
  const body = (
    <>
      <Fa className={`exv-name ${struck ? 'is-struck' : ''}`.trim()}>{village.name}</Fa>
      <span className="exv-code uw-num">{village.code || '—'}</span>
    </>
  )
  if (!onClick) return <span className={`exv ${className}`.trim()} style={style}>{body}</span>
  return (
    <button
      type="button"
      className={`exv is-button ${pressed ? 'is-on' : ''} ${className}`.trim()}
      style={style}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {body}
    </button>
  )
}
