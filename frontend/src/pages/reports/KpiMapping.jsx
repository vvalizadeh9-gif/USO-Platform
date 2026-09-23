import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Link2, Pencil, Repeat } from 'lucide-react'
import { Link } from 'react-router-dom'
import api from '../../api/client'
import { EmptyState, Loading, PageHead } from '../../components/ui'
import { importStamp } from './kpiTheme'

/**
 * Reports → KPI & Performance → Mapping. PM only, on the server as well.
 *
 * Two different edits live here and the screen keeps them apart, because the
 * table is effective-dated and conflating them would put a handover in the
 * record that never happened:
 *
 * **Edit** corrects a row that was typed wrong. There was never a period
 * during which the old value was true, so it is changed in place and no
 * history is written.
 *
 * **Reassign** hands a province over from one date. The current row is closed
 * at that date and a new one opened, so a result computed for last quarter
 * still belongs to whoever held the province then.
 *
 * The third panel links a user account to a name in this table. A Regional
 * Manager or Coordinator account that is not linked is refused the KPI page
 * with an explanation, so this is where that gets fixed.
 */
export default function KpiMapping() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)

  const load = useCallback(() => {
    setError('')
    api
      .get('/kpi/mapping')
      .then((r) => setData(r.data))
      .catch((err) =>
        setError(err?.response?.data?.detail ?? 'Could not load the province mapping.')
      )
  }, [])

  useEffect(load, [load])

  if (error) {
    return (
      <>
        <PageHead eyebrow="KPI &amp; Performance" title="Province mapping" />
        <div className="card card-pad"><EmptyState title="Not available" hint={error} /></div>
      </>
    )
  }
  if (!data) return <Loading label="Loading province mapping" />

  return (
    <div className="kpi">
      <PageHead
        eyebrow="KPI &amp; Performance"
        title="Province mapping"
        subtitle={`Last CPM import · ${importStamp(data.last_cpm_import)}`}
        actions={
          <Link className="btn btn-ghost kpi-round" to="/reports/kpi">
            <ArrowLeft size={15} aria-hidden="true" /> Back to KPI
          </Link>
        }
      />

      {data.unmapped_provinces.length > 0 && (
        <p className="kpi-banner warn">
          These provinces exist in the platform but are in no one&apos;s scope:{' '}
          <strong>{data.unmapped_provinces.join(', ')}</strong>. Their villages are
          counted in the country total and shown as their own row.
        </p>
      )}

      <div className="kpi-mapping">
        <section className="card kpi-card">
          <header className="kpi-heatmap-head">
            <h3 className="kpi-card-title">31 provinces</h3>
          </header>
          <div className="kpi-table-wrap">
            <table className="kpi-table mapping">
              <thead>
                <tr>
                  <th scope="col">Province</th>
                  <th scope="col">CRA region</th>
                  <th scope="col">PSO coordinator</th>
                  <th scope="col">Regional manager</th>
                  <th scope="col">Effective from</th>
                  <th scope="col"><span className="kpi-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">{row.province_en}</th>
                    <td className="kpi-plain">{row.cra_region}</td>
                    <td className="kpi-plain">{row.pso_coordinator}</td>
                    <td className="kpi-plain">{row.regional_manager}</td>
                    <td className="kpi-plain">{row.effective_from}</td>
                    <td className="kpi-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Edit ${row.province_en}`}
                        onClick={() => setEditing({ row, mode: 'edit' })}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Reassign ${row.province_en}`}
                        onClick={() => setEditing({ row, mode: 'reassign' })}
                      >
                        <Repeat size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="kpi-side">
          <PeoplePanel title="Provinces per coordinator" people={data.people.coordinators} />
          <PeoplePanel title="Provinces per regional manager" people={data.people.regional_managers} />
          <LinksPanel />
        </aside>
      </div>

      {editing && (
        <EditDialog
          row={editing.row}
          mode={editing.mode}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function PeoplePanel({ title, people }) {
  return (
    <section className="card card-pad kpi-card">
      <h3 className="kpi-card-title">{title}</h3>
      <ul className="kpi-people">
        {people.map((person) => (
          <li key={person.name}>
            <span className="kpi-person-name">{person.name}</span>
            <span className="kpi-person-count">{person.count}</span>
            <span className="kpi-person-list">{person.provinces.join(', ')}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Which user account is which person. An unlinked account cannot open the page. */
function LinksPanel() {
  const [users, setUsers] = useState(null)
  const [names, setNames] = useState({ regional_managers: [], coordinators: [] })
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api.get('/kpi/mapping/links').then((r) => setUsers(r.data)).catch(() => setUsers([]))
    api.get('/kpi/mapping/names').then((r) => setNames(r.data)).catch(() => {})
  }, [])

  useEffect(load, [load])

  const save = async (user, value) => {
    setBusy(user.id)
    setError('')
    try {
      await api.put(`/kpi/mapping/links/${user.id}`, { kpi_person_name: value || null })
      load()
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Could not save that link.')
    } finally {
      setBusy(null)
    }
  }

  if (!users) return <section className="card card-pad kpi-card"><Loading label="Loading accounts" /></section>

  return (
    <section className="card card-pad kpi-card">
      <h3 className="kpi-card-title">
        <Link2 size={15} aria-hidden="true" /> Account links
      </h3>
      <p className="kpi-note">
        A Regional Manager or Coordinator account that is not linked to a name here
        cannot open the KPI page. Contractor accounts are linked through their
        contractor, which is the DT SC value from CPM.
      </p>
      {error && <div className="kpi-error">{error}</div>}
      {users.length === 0 ? (
        <EmptyState title="No accounts" hint="No Regional Manager or Coordinator accounts exist yet." />
      ) : (
        <ul className="kpi-links">
          {users.map((user) => (
            <li key={user.id}>
              <span className="kpi-person-name">{user.full_name}</span>
              <select
                className="input"
                aria-label={`Person for ${user.full_name}`}
                value={user.kpi_person_name ?? ''}
                disabled={busy === user.id}
                onChange={(event) => save(user, event.target.value)}
              >
                <option value="">Not linked</option>
                {(user.role_name === 'RegionalManager'
                  ? names.regional_managers
                  : names.coordinators
                ).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function EditDialog({ row, mode, onClose, onSaved }) {
  const reassigning = mode === 'reassign'
  const [form, setForm] = useState({
    cra_region: row.cra_region,
    pso_coordinator: row.pso_coordinator,
    regional_manager: row.regional_manager,
    effective_from: new Date().toISOString().slice(0, 10),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value })

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (reassigning) {
        await api.post(`/kpi/mapping/${row.id}/reassign`, form)
      } else {
        const { effective_from: _ignored, ...rest } = form
        await api.put(`/kpi/mapping/${row.id}`, rest)
      }
      onSaved()
    } catch (err) {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Could not save that change.')
      setBusy(false)
    }
  }

  const title = reassigning
    ? `Reassign ${row.province_en}`
    : `Edit ${row.province_en}`

  return (
    <div className="kpi-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <form className="card card-pad kpi-dialog" onSubmit={submit}>
        <h3 className="kpi-card-title">{title}</h3>
        <p className="kpi-note">
          {reassigning
            ? 'The current row is closed on this date and a new one opened. Results already recorded stay with the previous owner.'
            : 'Corrects the current row in place. Use Reassign when the province genuinely changes hands.'}
        </p>

        <div className="field">
          <label htmlFor="kpi-cra-region">CRA region</label>
          <input
            id="kpi-cra-region"
            className="input"
            value={form.cra_region}
            onChange={set('cra_region')}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="kpi-coordinator">PSO coordinator</label>
          <input
            id="kpi-coordinator"
            className="input"
            value={form.pso_coordinator}
            onChange={set('pso_coordinator')}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="kpi-manager">Regional manager</label>
          <input
            id="kpi-manager"
            className="input"
            value={form.regional_manager}
            onChange={set('regional_manager')}
            required
          />
        </div>
        {reassigning && (
          <div className="field">
            <label htmlFor="kpi-effective-from">Effective from</label>
            <input
              id="kpi-effective-from"
              className="input"
              type="date"
              value={form.effective_from}
              onChange={set('effective_from')}
              required
            />
          </div>
        )}

        {error && <div className="kpi-error">{error}</div>}

        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : reassigning ? 'Reassign' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
