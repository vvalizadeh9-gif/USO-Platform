import { MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'
import api from '../../api/client'
import { Loading } from '../../components/ui'
import { useToast } from '../../context/ToastContext'

/**
 * Who owns each province, for Coordinator and Regional Manager.
 *
 * Neither role carries a village-level attribution the way a Contractor
 * does (a contractor is whoever a work item names) — "which coordinator is
 * responsible for this province" was previously not recorded anywhere, only
 * derivable indirectly from province *access* grants, which answer "can
 * see", not "owns". This screen is the one place the actual assignment is
 * made; every Coordinator/Regional Manager filter elsewhere (the Acceptance
 * Dashboard today) reads it back, keyed off `Province.coordinator_user_id` /
 * `regional_manager_user_id`.
 *
 * Each select saves itself on change — there is no separate edit mode,
 * because there is nothing to draft: a province either has an owner or it
 * doesn't, and changing it is a single fact, not a form.
 */
export default function ProvinceAssignmentsTab() {
  const toast = useToast()
  const [provinces, setProvinces] = useState(null)
  const [coordinators, setCoordinators] = useState([])
  const [regionalManagers, setRegionalManagers] = useState([])
  const [savingId, setSavingId] = useState(null)

  function load() {
    api
      .get('/admin/provinces')
      .then((r) => setProvinces(r.data))
      .catch(() => setProvinces([]))
  }

  useEffect(() => {
    load()
    api
      .get('/reference/roles')
      .then((r) => {
        const roleId = Object.fromEntries(r.data.map((role) => [role.name, role.id]))
        if (roleId.Coordinator != null) {
          api
            .get('/admin/users', { params: { role_id: roleId.Coordinator } })
            .then((res) => setCoordinators(res.data))
            .catch(() => setCoordinators([]))
        }
        if (roleId.RegionalManager != null) {
          api
            .get('/admin/users', { params: { role_id: roleId.RegionalManager } })
            .then((res) => setRegionalManagers(res.data))
            .catch(() => setRegionalManagers([]))
        }
      })
      .catch(() => {})
  }, [])

  async function save(province, patch) {
    setSavingId(province.id)
    try {
      const body = {
        coordinator_user_id: province.coordinator_user_id,
        regional_manager_user_id: province.regional_manager_user_id,
        ...patch,
      }
      const { data } = await api.put(`/admin/provinces/${province.id}/assignment`, body)
      setProvinces((prev) => prev.map((p) => (p.id === province.id ? data : p)))
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
    } finally {
      setSavingId(null)
    }
  }

  if (!provinces) return <Loading label="Loading provinces" />

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-pad" style={{ paddingBottom: 12 }}>
        <h3 style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 7 }}>
          <MapPin size={15} /> Province Assignments
        </h3>
        <p className="dim" style={{ fontSize: 12.5, marginTop: 4, maxWidth: '68ch' }}>
          Who owns each province. Set here, it maps automatically wherever a
          Coordinator or Regional Manager filter appears across UEP — the
          Acceptance Dashboard today, and anything else that reads it later.
        </p>
      </div>
      <table>
        <thead>
          <tr>
            <th>Province</th>
            <th>Coordinator</th>
            <th>Regional Manager</th>
            <th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {provinces.map((p) => (
            <tr key={p.id}>
              <td className="text-data" style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
                {p.name}
              </td>
              <td>
                <select
                  className="input"
                  value={p.coordinator_user_id ?? ''}
                  disabled={savingId === p.id}
                  onChange={(e) =>
                    save(p, {
                      coordinator_user_id: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">— Unassigned —</option>
                  {coordinators.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="input"
                  value={p.regional_manager_user_id ?? ''}
                  disabled={savingId === p.id}
                  onChange={(e) =>
                    save(p, {
                      regional_manager_user_id: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">— Unassigned —</option>
                  {regionalManagers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name}
                    </option>
                  ))}
                </select>
              </td>
              <td>{savingId === p.id && <div className="spinner" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
