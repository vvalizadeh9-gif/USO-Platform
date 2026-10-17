// "Whose?" -- the title of Area for PM and Viewer. Defaults
// to the whole country; offers any person, province or CRA region, and the
// people who owned provinces once (their past months are still theirs).
import { useRpData } from './hooks'
import { COUNTRY, SCOPE_GROUPS, parseScopeValue, scopeValue } from './model'
import Select from '../../../components/Select'

export default function ScopePicker({ scope, onChange }) {
  const { data } = useRpData('/kpi/lenses')
  const labels = data?.labels?.province ?? {}

  return (
    <Select
      className="rp-scope-picker"
      aria-label="Whose figures"
      value={scopeValue(scope)}
      onChange={(event) => {
        const next = parseScopeValue(event.target.value)
        onChange(next.lens === 'country' ? null : next)
      }}
    >
      <option value="country">{COUNTRY.label}</option>
      {SCOPE_GROUPS.map(({ lens, label }) => {
        const options = data?.options?.[lens] ?? []
        const past = data?.past?.[lens] ?? []
        if (!options.length && !past.length) return null
        return (
          <optgroup key={lens} label={label}>
            {options.map((key) => (
              <option key={key} value={`${lens}:${key}`}>
                {lens === 'province' ? labels[key] ?? key : key}
              </option>
            ))}
            {past.map((key) => (
              <option key={`past-${key}`} value={`${lens}:${key}`}>
                {key} (past)
              </option>
            ))}
          </optgroup>
        )
      })}
      {/* A scope chosen from elsewhere (a Month owner, a shared link) that the
          list does not offer, or not yet: shown as itself, never as the country. */}
      {scope && scope.lens !== 'country' && !listed(data, scope) && (
        <option value={scopeValue(scope)}>{scope.key}</option>
      )}
    </Select>
  )
}

function listed(data, scope) {
  return [...(data?.options?.[scope.lens] ?? []), ...(data?.past?.[scope.lens] ?? [])]
    .includes(scope.key)
}
