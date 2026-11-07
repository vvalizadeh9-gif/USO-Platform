import { Link } from 'react-router-dom'
import Icon from './Icon'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../lib/roles'
import '../styles/home.css'

/**
 * The standard UEP "no access" screen: what a person sees when they open a
 * page their role may not use (a route guard, or a record the server answers
 * 403 for). Built from Home's empty card -- no design of its own. Never a
 * blank page and never a redirect that leaves them wondering where they went.
 */
export default function NoAccess() {
  const { user } = useAuth()
  return (
    <div className="uep-home uep-no-access">
      <section className="hw-empty" role="alert" aria-labelledby="no-access-title">
        <Icon name="locked" size={20} />
        <b id="no-access-title">You don't have access to this page</b>
        <span>It isn't part of your role in UEP.</span>
        <Link className="uep-no-access-link" to={homeFor(user?.role?.name)}>Go to your start page</Link>
      </section>
    </div>
  )
}
