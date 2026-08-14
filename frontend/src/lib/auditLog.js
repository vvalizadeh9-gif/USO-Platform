// Turns a raw AuditLogOut row (module/entity_type/old_value/new_value) into a
// readable sentence, so the Overview and Audit Log tabs never have to dump
// raw JSON in front of an admin. Kept in one place so both screens describe
// the same event the same way.
const ENTITY_LABELS = {
  User: 'user',
  CpmChangeRequest: 'a CPM change request',
  CpmDataWipe: 'all CPM data',
  CpmImportBatch: 'a CPM import',
  WorkItem: 'work item',
  WorkItemBulk: 'a bulk assignment',
  HcAssignment: 'health check assignment',
  HcTask: 'health check task',
  DriveTest: 'a drive test',
  Acceptance: 'an acceptance record',
}

function entityLabel(entityType) {
  return ENTITY_LABELS[entityType] || entityType
}

function lowerFirst(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s
}

export function describeAuditEntry(entry) {
  const actor = entry.user_full_name || 'System'
  const label = entityLabel(entry.entity_type)
  const idPart = entry.entity_id != null ? ` #${entry.entity_id}` : ''
  const nv = entry.new_value || {}

  switch (entry.entity_type) {
    case 'User':
      if (nv.username) return `${actor} created user "${nv.username}"${idPart}`
      if (entry.reason) return `${actor} ${lowerFirst(entry.reason)}`
      return `${actor} updated ${label}${idPart}`

    case 'CpmChangeRequest':
      return `${actor} ${String(nv.decision || 'decided on').toLowerCase()} ${label}${idPart}`

    case 'CpmDataWipe': {
      const total = Object.values(nv).reduce((sum, v) => sum + (Number(v) || 0), 0)
      return `${actor} erased ${label} (${total} records removed)`
    }

    case 'CpmImportBatch':
      return `${actor} imported "${nv.filename || 'a CPM file'}"${nv.rows != null ? ` (${nv.rows} rows)` : ''}`

    case 'WorkItem':
      if (entry.module === 'HealthCheck') return `${actor} recorded a health check status (${nv.status || '—'}) on ${label}${idPart}`
      if (entry.module === 'Assignment') {
        if (nv.returned) return `${actor} returned ${label}${idPart}${nv.reason ? `: ${nv.reason}` : ''}`
        if ('contractor_id' in nv) return `${actor} assigned ${label}${idPart} to a contractor`
      }
      if (entry.module === 'DriveTest') return `${actor} submitted a drive test for ${label}${idPart}`
      return `${actor} updated ${label}${idPart}`

    case 'WorkItemBulk':
      return `${actor} bulk-assigned ${nv.count ?? '?'} work items to a contractor`

    case 'DriveTest':
      return `${actor} recorded coordinator decision "${nv.coordinator_decision || '—'}" on ${label}${idPart}`

    case 'HcAssignment':
      if (nv.code) return `${actor} created ${label} "${nv.code}"`
      if ('bulk_applied' in nv) return `${actor} bulk-applied results to ${nv.bulk_applied} sites on ${label}${idPart}`
      return `${actor} updated ${label}${idPart}`

    case 'HcTask':
      if (nv.overall_result) return `${actor} recorded "${nv.overall_result}" on ${label}${idPart}`
      if ('reviewed' in nv) return `${actor} validated ${label}${idPart}${nv.problem_category ? ` as ${nv.problem_category}` : ''}`
      return `${actor} updated ${label}${idPart}`

    case 'Acceptance':
      return `${actor} updated ${label}${idPart} (ICT: ${nv.ict || '—'}, CRA: ${nv.cra || '—'})`

    default:
      return entry.reason ? `${actor} ${lowerFirst(entry.reason)}` : `${actor} updated ${label}${idPart}`
  }
}

export const AUDIT_MODULES = ['Admin', 'CPM', 'Assignment', 'HealthCheck', 'DriveTest', 'Acceptance']

export const AUDIT_ENTITY_TYPES = [
  'User', 'CpmChangeRequest', 'CpmDataWipe', 'CpmImportBatch',
  'WorkItem', 'WorkItemBulk', 'HcAssignment', 'HcTask', 'DriveTest', 'Acceptance',
]

export function formatDateTime(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}
