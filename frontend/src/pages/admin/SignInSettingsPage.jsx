// Admin › Sign-in page (UEP-26): the support contact shown in the sign-in
// help panel, and a planned-update notice with its time window. A live
// preview copies the help panel as the Admin types. Admin only (the
// signin_settings feature); the server re-checks on every save.
import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../api/client'
import Icon from '../../components/Icon'
import PageHeader from '../../components/PageHeader'
import { useAuth } from '../../context/AuthContext'
import { FEATURE, can } from '../../lib/access'
import { detailMessage } from '../../lib/apiError'
import { ContactList } from '../auth/HelpPanel'
import SignInNotice from '../auth/SignInNotice'
import useLeaveGuard from './access/useLeaveGuard'
import {
  EMPTY_FORM,
  LIMITS,
  MESSAGES,
  formFromServer,
  isDirty,
  lastSavedText,
  previewSupport,
  toPayload,
  validateForm,
} from './signInSettings'
import '../../styles/signin-settings.css'

function TextField({ id, label, value, onChange, maxLength, error, type = 'text', dir, disabled }) {
  return (
    <div className="ssp-field">
      <label htmlFor={id} className="ssp-label">{label}</label>
      <input
        id={id}
        className="ssp-input"
        type={type}
        value={value}
        maxLength={maxLength}
        dir={dir}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && <FieldError id={`${id}-error`} message={error} />}
    </div>
  )
}

function FieldError({ id, message }) {
  return (
    <p id={id} className="ssp-error" role="alert">
      <Icon name="warning--alt" size={16} />
      {message}
    </p>
  )
}

function SupportCard({ form, set, errors, disabled }) {
  return (
    <section className="ssp-card" aria-labelledby="ssp-support">
      <h2 id="ssp-support" className="ssp-card-title">
        <Icon name="phone" size={18} />
        Support contact
      </h2>
      <TextField id="ssp-name" label="Team or person" value={form.support_name} maxLength={LIMITS.support_name}
        onChange={set('support_name')} disabled={disabled} />
      <TextField id="ssp-hours" label="Working hours" value={form.support_hours} maxLength={LIMITS.support_hours}
        onChange={set('support_hours')} disabled={disabled} />
      <TextField id="ssp-email" label="Email" type="email" dir="ltr" value={form.support_email}
        maxLength={LIMITS.support_email} onChange={set('support_email')} error={errors.support_email} disabled={disabled} />
      <TextField id="ssp-phone" label="Phone or extension" dir="ltr" value={form.support_phone}
        maxLength={LIMITS.support_phone} onChange={set('support_phone')} disabled={disabled} />
    </section>
  )
}

function NoticeCard({ form, set, errors, disabled }) {
  return (
    <section className="ssp-card" aria-labelledby="ssp-notice">
      <h2 id="ssp-notice" className="ssp-card-title">
        <Icon name="notification" size={18} />
        Planned update notice
      </h2>
      <label className="ssp-toggle">
        Show on the sign-in page
        <input
          type="checkbox"
          role="switch"
          checked={form.notice_enabled}
          disabled={disabled}
          onChange={(e) => set('notice_enabled')(e.target.checked)}
        />
        <span className="ssp-switch" aria-hidden="true" />
      </label>
      <div className="ssp-field">
        <label htmlFor="ssp-message" className="ssp-label">Message</label>
        <textarea
          id="ssp-message"
          className="ssp-input ssp-textarea"
          value={form.notice_text}
          maxLength={LIMITS.notice_text}
          disabled={disabled}
          onChange={(e) => set('notice_text')(e.target.value)}
          aria-invalid={errors.notice_text ? true : undefined}
          aria-describedby={errors.notice_text ? 'ssp-message-error' : undefined}
        />
        {errors.notice_text && <FieldError id="ssp-message-error" message={errors.notice_text} />}
      </div>
      <TextField id="ssp-from" label="Show from (Tehran time)" type="datetime-local" value={form.notice_from}
        onChange={set('notice_from')} disabled={disabled} />
      <TextField id="ssp-to" label="Hide after (Tehran time)" type="datetime-local" value={form.notice_to}
        onChange={set('notice_to')} error={errors.notice_to} disabled={disabled} />
    </section>
  )
}

function PreviewCard({ form }) {
  const noticeText = form.notice_enabled ? form.notice_text.trim() : ''
  return (
    <section className="ssp-card ssp-preview" aria-labelledby="ssp-preview" aria-live="polite">
      <h2 id="ssp-preview" className="ssp-card-title">Preview</h2>
      <div className="ssp-preview-band">
        <div className="ssp-preview-card uep-signin-preview">
          {noticeText && <SignInNotice>{noticeText}</SignInNotice>}
          <h3 className="ssp-preview-title">Ask your UEP administrator</h3>
          <ContactList support={previewSupport(form)} />
        </div>
      </div>
    </section>
  )
}

export default function SignInSettingsPage() {
  const { user } = useAuth()
  const canEdit = can(user, FEATURE.SIGNIN_SETTINGS, 'edit')
  const rootRef = useRef(null)

  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [saved, setSaved] = useState(EMPTY_FORM)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showErrors, setShowErrors] = useState(false)
  const [busy, setBusy] = useState(false)
  // 'saved' after a save; a server message after a refusal.
  const [outcome, setOutcome] = useState(null)

  const load = useCallback(() => {
    setLoadError(false)
    return api
      .get('/admin/signin-settings')
      .then(({ data: row }) => {
        const values = formFromServer(row)
        setData(row)
        setSaved(values)
        setForm(values)
      })
      .catch(() => setLoadError(true))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const dirty = isDirty(form, saved)
  const errors = validateForm(form)
  const visibleErrors = showErrors ? errors : {}
  useLeaveGuard(dirty, rootRef, MESSAGES.leave)

  const set = (field) => (value) => {
    setForm((f) => ({ ...f, [field]: value }))
    setOutcome(null)
  }

  function discard() {
    setForm(saved)
    setShowErrors(false)
    setOutcome(null)
  }

  async function save() {
    if (!dirty || busy) return
    if (Object.keys(errors).length > 0) {
      setShowErrors(true)
      return
    }
    setBusy(true)
    try {
      const { data: row } = await api.put('/admin/signin-settings', toPayload(form))
      const values = formFromServer(row)
      setData(row)
      setSaved(values)
      setForm(values)
      setShowErrors(false)
      setOutcome('saved')
    } catch (err) {
      setOutcome(detailMessage(err, 'Could not save. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ssp-page" ref={rootRef}>
      <PageHeader title="Sign-in page" count={lastSavedText(data) || null} />
      {loadError ? (
        <div className="ssp-card ssp-load-error">
          <b>Couldn&apos;t load the sign-in page settings</b>
          <button type="button" className="btn btn-secondary btn-sm" onClick={load}>Retry</button>
        </div>
      ) : (
        <>
          <form
            className="ssp-grid"
            noValidate
            aria-busy={!data || busy}
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <SupportCard form={form} set={set} errors={visibleErrors} disabled={!canEdit || !data} />
            <NoticeCard form={form} set={set} errors={visibleErrors} disabled={!canEdit || !data} />
            <PreviewCard form={form} />
          </form>
          {canEdit && (
            <div className="ssp-bar">
              <span className="ssp-note" role="status">
                {outcome === 'saved' && (
                  <>
                    <span className="ssp-ok" aria-hidden="true"><Icon name="checkmark" size={16} /></span>
                    {MESSAGES.saved}
                  </>
                )}
                {outcome && outcome !== 'saved' && <span className="ssp-note-error">{outcome}</span>}
              </span>
              <button type="button" className="btn btn-secondary" disabled={!dirty || busy} onClick={discard}>
                Discard changes
              </button>
              <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={save}>
                <Icon name="save" size={16} />
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
