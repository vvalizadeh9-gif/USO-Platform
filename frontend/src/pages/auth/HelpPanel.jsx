// "Ask your UEP administrator": the view inside the sign-in card opened from
// "Forgot password?" and "Need access?" (UEP-26). The contact comes from
// Admin › Sign-in page and is rendered as text, never as HTML.
import { forwardRef } from 'react'
import Icon from '../../components/Icon'
import { contactRows } from './signInModel'

/** @param {{ support: import('./useSignInSettings').Support }} props */
export function ContactList({ support }) {
  const rows = contactRows(support)
  if (rows.length === 0) return <p className="uep-signin-empty">Contact details have not been set yet.</p>
  return (
    <ul className="uep-signin-contact">
      {rows.map((row) => (
        <li key={row.icon} className="uep-signin-contact-row">
          <Icon name={row.icon} size={18} className="uep-signin-contact-icon" />
          <span>
            <b>{row.title}</b>
            {row.detail && <span>{row.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * @param {{ support: import('./useSignInSettings').Support, onBack: () => void }} props
 */
const HelpPanel = forwardRef(function HelpPanel({ support, onBack }, backRef) {
  return (
    <div className="uep-signin-help">
      <button ref={backRef} type="button" className="uep-signin-back" onClick={onBack}>
        <Icon name="arrow--left" size={16} />
        Back
      </button>
      <h1 className="uep-signin-heading">Ask your UEP administrator</h1>
      <p className="uep-signin-lead">Administrators create accounts and reset passwords.</p>
      <ContactList support={support} />
    </div>
  )
})

export default HelpPanel
