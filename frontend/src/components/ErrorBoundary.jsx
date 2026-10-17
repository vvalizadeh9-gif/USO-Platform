import { Component, useState } from 'react'
import api from '../api/client'
import Icon from './Icon'
import BrandMark from './BrandMark'

/**
 * Error screens at three levels (UEP-13 §3.1): a card, a routed page, the
 * whole app. Each caught error gets an Error ID the person can read out, and
 * is reported to the server once under that ID; a failed report is ignored.
 */

// eslint-disable-next-line react-refresh/only-export-components -- tested on its own
export function newErrorId() {
  const bytes = new Uint8Array(3)
  globalThis.crypto?.getRandomValues?.(bytes)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `UEP-${hex.toUpperCase()}`
}

// eslint-disable-next-line react-refresh/only-export-components -- tested on its own
export function reportError(errorId, error) {
  try {
    const stack = String(error?.stack ?? '').slice(0, 4096)
    api
      .post('/client-errors', {
        error_id: errorId,
        route: window.location.pathname,
        message: String(error?.message ?? error).slice(0, 2000),
        stack,
        release: import.meta.env.VITE_RELEASE ?? 'dev',
        user_agent: navigator.userAgent.slice(0, 512),
      })
      .catch(() => {})
  } catch {
    // Reporting must never be the thing that fails.
  }
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, errorId: null }
    this.retry = this.retry.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error, errorId: newErrorId() }
  }

  componentDidCatch(error) {
    reportError(this.state.errorId, error)
  }

  componentDidUpdate(prev) {
    // A new route (or any change of resetKey) gets a fresh start.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, errorId: null })
    }
  }

  retry() {
    this.setState({ error: null, errorId: null })
    this.props.onRetry?.()
  }

  render() {
    const { error, errorId } = this.state
    if (!error) return this.props.children
    const { level = 'page', title, tile } = this.props
    if (level === 'card') return <CardError title={title} tile={tile} onRetry={this.retry} />
    if (level === 'app') return <AppError errorId={errorId} />
    return <PageError errorId={errorId} />
  }
}

function ErrorIdCaption({ errorId }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard
      ?.writeText(errorId)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }
  return (
    <p className="uep-error-id">
      Error ID <code>{errorId}</code> ·{' '}
      <button type="button" className="uep-error-copy" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </p>
  )
}

function reload() {
  window.location.reload()
}

function PageError({ errorId }) {
  return (
    <div className="uep-error-page" role="alert">
      <span className="uep-error-tile" aria-hidden="true">
        <Icon name="warning" size={20} />
      </span>
      <h1 className="uep-error-title">This page couldn&rsquo;t load</h1>
      <p className="uep-error-line">Your data is safe. Reload to try again.</p>
      <div className="uep-error-actions">
        <button type="button" className="btn btn-primary" onClick={reload}>
          <Icon name="renew" size={16} /> Reload page
        </button>
        <a className="btn" href="/home">
          Go to Home
        </a>
      </div>
      <ErrorIdCaption errorId={errorId} />
    </div>
  )
}

function AppError({ errorId }) {
  return (
    <div className="uep-error-app" role="alert">
      <BrandMark />
      <h1 className="uep-error-title">UEP couldn&rsquo;t start</h1>
      <div className="uep-error-actions">
        <button type="button" className="btn btn-primary" onClick={reload}>
          <Icon name="renew" size={16} /> Reload
        </button>
      </div>
      <ErrorIdCaption errorId={errorId} />
    </div>
  )
}

function CardError({ title, tile = 'warning', onRetry }) {
  const body = (
    <div className="uep-error-card-body" role="alert">
      <Icon name="warning" size={16} className="uep-error-card-icon" />
      <span>Couldn&rsquo;t load this card</span>
      <button type="button" className="btn" onClick={onRetry}>
        <Icon name="renew" size={16} /> Retry
      </button>
    </div>
  )
  // Inside a card that draws its own header (Section), only the body.
  if (!title) return body
  return (
    <section className="dt-section uep-error-card">
      <header className="dt-section-head dt-section-head-inline">
        <span className="ui-card-chip dt-card-tile" aria-hidden="true">
          <Icon name={tile} size={16} />
        </span>
        <h2 className="dt-section-title">{title}</h2>
      </header>
      {body}
    </section>
  )
}

/** Wraps one dashboard card. Retry remounts it, which refetches its data. */
export function CardBoundary({ title, tile, onRetry, children }) {
  const [attempt, setAttempt] = useState(0)
  const retry = () => {
    setAttempt((n) => n + 1)
    onRetry?.()
  }
  return (
    <ErrorBoundary level="card" title={title} tile={tile} onRetry={retry}>
      <CardKey key={attempt}>{children}</CardKey>
    </ErrorBoundary>
  )
}

function CardKey({ children }) {
  return children
}
