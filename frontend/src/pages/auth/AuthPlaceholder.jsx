// Placeholder pages linked from the sign-in screen. They will be designed
// later; until then each says, in one line, what to do instead.
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon'
import { AuthFooter, AuthLogo } from './AuthFrame'

const PAGES = Object.freeze({
  'forgot-password': {
    title: 'Forgot your password?',
    body: 'Contact your UEP administrator. They will check who you are and give you a temporary password.',
  },
  'request-access': {
    title: 'Need access to UEP?',
    body: 'Contact your UEP administrator. They create accounts and choose what each person can see.',
  },
  privacy: { title: 'Privacy', body: 'The UEP privacy notice will be published here.' },
  terms: { title: 'Terms', body: 'The UEP terms of use will be published here.' },
  help: { title: 'Help', body: 'UEP help will be published here. For now, contact your UEP administrator.' },
})

/** @param {{ page: keyof typeof PAGES }} props */
export default function AuthPlaceholder({ page }) {
  const { title, body } = PAGES[page]
  return (
    <div className="uep-signin">
      <div className="uep-signin-side">
        <AuthLogo />
        <main className="uep-signin-center">
          <div className="uep-signin-column">
            <Link to="/login" className="uep-auth-back">
              <Icon name="arrow--left" size={16} />
              Back to sign in
            </Link>
            <h1 className="uep-signin-title">{title}</h1>
            <p className="uep-signin-subtitle">{body}</p>
          </div>
        </main>
        <AuthFooter />
      </div>
    </div>
  )
}
