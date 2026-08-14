// Maps internal role names (as stored in the DB and used for authorization)
// to human-friendly display labels. Keeping this in one place means the UI
// can be relabelled without touching any permission logic.
const ROLE_LABELS = {
  Admin: 'Administrator',
  PM: 'Project Manager',
  Coordinator: 'Coordinator',
  RegionalManager: 'Regional Manager',
  Contractor: 'Contractor',
  Viewer: 'Viewer',
  // Health-check problem-category owners. Each owns one category and works
  // only its Fix Queue.
  CpgPower: 'CPG Power',
  CpgRolloutPM: 'CPG Rollout Project Manager (On-Site)',
  ManagedService: 'Managed Service (MS)',
  NwgPlanning: 'NWG Planning',
}

// The four roles that own a health-check problem category. Used for route
// guards and nav visibility; the backend decides permissions from
// Role.is_category_owner, so this list only shapes what the UI offers.
export const CATEGORY_OWNER_ROLES = [
  'CpgPower',
  'CpgRolloutPM',
  'ManagedService',
  'NwgPlanning',
]

export function isCategoryOwner(roleName) {
  return CATEGORY_OWNER_ROLES.includes(roleName)
}

export function roleLabel(name) {
  return ROLE_LABELS[name] || name
}
