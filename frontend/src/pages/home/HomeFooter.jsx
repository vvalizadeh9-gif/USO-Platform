import { useEffect, useState } from 'react'
import { clockLabel } from '../../lib/greeting'
import { HELP_URL } from './links'

// Set at build time from package.json (vite.config.js).
// eslint-disable-next-line no-undef
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''

/** Whether the API answers its health check, read once when Home opens. */
function useServiceUp() {
  const [up, setUp] = useState(null)
  useEffect(() => {
    let active = true
    fetch('/api/health')
      .then((r) => active && setUp(r.ok))
      .catch(() => active && setUp(false))
    return () => {
      active = false
    }
  }, [])
  return up
}

export default function HomeFooter({ generatedAt }) {
  const up = useServiceUp()
  return (
    <footer className="h-footer">
      {up !== null && (
        <span className={`h-status ${up ? '' : 'down'}`.trim()} role="status">
          <i aria-hidden="true" />
          {up ? 'All systems normal' : 'Service unreachable'}
        </span>
      )}
      {generatedAt && <span>Data as of {clockLabel(new Date(generatedAt))}</span>}
      <span className="h-spacer" />
      {HELP_URL && (
        <a href={HELP_URL} target="_blank" rel="noreferrer">Help</a>
      )}
      {VERSION && <span>UEP {VERSION}</span>}
    </footer>
  )
}
