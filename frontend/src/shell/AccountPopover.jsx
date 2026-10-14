import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import { roleLabel } from '../lib/roles'
import { usePopover } from './usePopover'

/** The account menu, anchored top-right. */
export default function AccountPopover({ user, onClose, onSignOut, openerRef }) {
  const ref = usePopover(onClose, openerRef)
  return (
    <>
      <div className="uep-backdrop uep-backdrop--clear" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className="uep-pop uep-account" role="dialog" aria-label="Account">
        <div className="uep-account-who">
          <b>{user?.full_name}</b>
          <span>{roleLabel(user?.role?.name)}</span>
        </div>
        <Link to="/change-password" className="uep-account-item" onClick={onClose}>
          <Icon name="password" size={16} />
          Profile and security
        </Link>
        <button type="button" className="uep-account-item" onClick={onSignOut}>
          <Icon name="logout" size={16} />
          Sign out
        </button>
      </div>
    </>
  )
}
