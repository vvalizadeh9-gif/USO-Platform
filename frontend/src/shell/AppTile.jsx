import Icon from '../components/Icon'

/** An app's colour tile with its white Carbon icon. */
export default function AppTile({ app, size = 36 }) {
  return (
    <span
      className="uep-app-tile"
      style={{ '--tile-size': `${size}px`, background: `var(${app.color})` }}
      aria-hidden="true"
    >
      <Icon name={app.icon} size={size >= 36 ? 20 : 16} />
    </span>
  )
}
