// A neutral notice inside the sign-in card (UEP-26): the planned update set in
// Admin, or "Your session expired". Text only.
import Icon from '../../components/Icon'

/** @param {{ children: import('react').ReactNode }} props */
export default function SignInNotice({ children }) {
  return (
    <p className="uep-signin-notice" role="status">
      <Icon name="information" size={16} className="uep-signin-notice-icon" />
      <span>{children}</span>
    </p>
  )
}
