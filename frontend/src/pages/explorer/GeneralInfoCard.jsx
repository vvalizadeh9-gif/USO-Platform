import Icon from '../../components/Icon'
import { Fa, StepError, TechChips } from '../../components/work/parts'
import { formatGregorian } from '../../lib/dates'
import { formatNumber } from '../../lib/numbers'
import { FIELD_ICONS } from './explorerModel'

const Missing = () => <span className="ex-missing">—</span>

const textOr = (value) => (value ? value : <Missing />)
const dateOr = (value) => textOr(formatGregorian(value))

/** The seven rows (UEP-11 §B4). Each field's icon and tile colour is
 * FIELD_ICONS[key], the same the list uses. */
const FIELDS = [
  { key: 'on_air', label: 'On air date', value: (g) => dateOr(g.on_air_date) },
  { key: 'dt_date', label: 'DT date', value: (g) => dateOr(g.dt_date) },
  { key: 'site_contractor', label: 'Site contractor', value: (g) => (g.site_contractor ? <Fa>{g.site_contractor}</Fa> : <Missing />) },
  { key: 'dt_contractor', label: 'DT contractor', value: (g) => (g.dt_contractor ? <Fa>{g.dt_contractor}</Fa> : <Missing />) },
  {
    key: 'technology', label: 'Requested technology',
    value: (g) => (g.requested_technology?.length ? <TechChips techs={g.requested_technology} /> : <Missing />),
  },
  { key: 'province', label: 'Province', value: (g) => (g.province ? <Fa>{g.province}</Fa> : <Missing />) },
  { key: 'villages', label: 'Target villages', value: (g) => formatNumber(g.hadaf_villages ?? 0) },
]

/** The left card: what the site is, at a glance. */
export default function GeneralInfoCard({ general, status, onRetry }) {
  return (
    <section className="hw-card ex-card ex-info" aria-labelledby="ex-info-title" aria-busy={status === 'loading' || undefined}>
      <header className="hw-head">
        <h2 id="ex-info-title" className="ex-card-title">General information</h2>
      </header>
      {status === 'error' ? (
        <StepError stepName="general information" onRetry={onRetry} />
      ) : (
        <dl className="ex-fields">
          {FIELDS.map((f) => (
            <div key={f.key} className="ex-field" data-field={f.key}>
              <span className="uep-app-tile ex-field-tile" style={{ '--tile-size': '36px', background: `var(${FIELD_ICONS[f.key].hue})` }} aria-hidden="true">
                <Icon name={FIELD_ICONS[f.key].icon} size={20} />
              </span>
              <dt>{f.label}</dt>
              <dd>{general ? f.value(general) : <span className="h-skel ex-skel-value" />}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
