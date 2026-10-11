// The pieces the sign-in page and its placeholder pages share: the UEP mark at
// the top and the legal footer at the bottom.
import { Link } from 'react-router-dom'

// eslint-disable-next-line no-undef
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''

/** Where the footer and help links go. Placeholders until those pages exist. */
export const AUTH_LINKS = Object.freeze({
  forgotPassword: '/forgot-password',
  requestAccess: '/request-access',
  privacy: '/privacy',
  terms: '/terms',
  help: '/help',
})

/** @param {{ style?: import('react').CSSProperties, className?: string }} props */
export function AuthLogo({ style, className = '' }) {
  return (
    <header className={`uep-auth-logo ${className}`} style={style}>
      <span className="uep-auth-logo-tile" aria-hidden="true">U</span>
      <span className="uep-auth-wordmark">UEP</span>
    </header>
  )
}

/** @param {{ style?: import('react').CSSProperties, className?: string }} props */
export function AuthFooter({ style, className = '' }) {
  return (
    <footer className={`uep-auth-footer ${className}`} style={style}>
      <nav aria-label="Legal" className="uep-auth-legal">
        <span>© {new Date().getFullYear()} USO</span>
        <span aria-hidden="true">·</span>
        <Link to={AUTH_LINKS.privacy}>Privacy</Link>
        <span aria-hidden="true">·</span>
        <Link to={AUTH_LINKS.terms}>Terms</Link>
        <span aria-hidden="true">·</span>
        <Link to={AUTH_LINKS.help}>Help</Link>
      </nav>
      {VERSION && <span className="uep-auth-version">UEP {VERSION}</span>}
    </footer>
  )
}
