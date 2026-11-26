// The line under a sign-in field: an error (red, with its icon) or a hint.
// Always in the document, so the live region exists before it has anything
// to say -- a region inserted together with its message is often not read.
import Icon from '../../components/Icon'

/**
 * @param {{ id: string, message?: string, tone?: 'error' | 'hint' }} props
 */
export default function FieldMessage({ id, message = '', tone = 'error' }) {
  return (
    <p
      id={id}
      role={tone === 'error' ? 'alert' : 'status'}
      className={tone === 'error' ? 'uep-signin-error' : 'uep-signin-hint'}
    >
      {message && (
        <>
          <Icon name="warning--alt" size={16} />
          {message}
        </>
      )}
    </p>
  )
}

