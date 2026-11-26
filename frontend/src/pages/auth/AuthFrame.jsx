// The frame the sign-in and change-password pages share (UEP-26): a deep
// cobalt band across the top with slow waves, the UEP mark top-left, the big
// title, one centred card resting on the band's edge, and the footer.
//
// The card's <h1> is the page heading; the big title is decorative text.
import UepMark from '../../components/UepMark'

// eslint-disable-next-line no-undef
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''

const TITLE_WORDS = ['USO', 'Enterprise', 'Platform']
const WAVES_A = [0, 1, 2, 3]
const WAVES_B = [0, 1, 2]

function Waves() {
  return (
    <div className="uep-signin-waves" aria-hidden="true">
      {WAVES_A.map((i) => (
        <span key={`a${i}`} className="uep-signin-wave" style={{ '--uep-wave': i }} />
      ))}
      {WAVES_B.map((i) => (
        <span key={`b${i}`} className="uep-signin-wave uep-signin-wave-b" style={{ '--uep-wave': i }} />
      ))}
    </div>
  )
}

function Title() {
  return (
    <div className="uep-signin-hero">
      {/* Decorative, not the page heading (the card's <h1> is). The words are
          drawn one by one; assistive technology reads the whole name once. */}
      <p className="uep-signin-title">
        <span className="sr-only">{TITLE_WORDS.join(' ')}</span>
        {TITLE_WORDS.map((word, i) => (
          <span key={word} className="uep-signin-word-mask" aria-hidden="true">
            <span className="uep-signin-word" style={{ '--uep-word': i }}>
              {word}
            </span>
          </span>
        ))}
      </p>
      <span className="uep-signin-rule" aria-hidden="true" />
    </div>
  )
}

export function AuthFooter() {
  return (
    <footer className="uep-signin-footer">
      <span>© {new Date().getFullYear()} USO</span>
      <span>Authorised use only. Sign-ins are recorded.</span>
      {VERSION ? <span>UEP {VERSION}</span> : <span />}
    </footer>
  )
}

/** The cobalt curtain that drops after a successful sign-in. */
export function SignedInCurtain() {
  return (
    <div className="uep-signin-curtain" role="status">
      <UepMark size={48} onDark className="uep-signin-curtain-mark" />
      <p>Opening Home</p>
    </div>
  )
}

/**
 * @param {{ children: import('react').ReactNode, overlay?: import('react').ReactNode }} props
 *   overlay: drawn over the whole page (the signed-in curtain).
 */
export default function AuthFrame({ children, overlay = null }) {
  return (
    <div className="uep-signin">
      <div className="uep-signin-band" aria-hidden="true">
        <Waves />
      </div>
      <header className="uep-signin-top">
        <span className="uep-signin-brand">
          <UepMark size={30} onDark animated className="uep-signin-mark" />
          <span className="uep-signin-wordmark">UEP</span>
        </span>
      </header>
      <main className="uep-signin-main">
        <Title />
        <div className="uep-signin-card">{children}</div>
      </main>
      <AuthFooter />
      {overlay}
    </div>
  )
}
