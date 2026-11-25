/**
 * Test-only: the access a built-in role has on day one, from the seed fixture
 * (lib/accessMatrix.json -- since UEP-25 the app reads GET /me/access, and the
 * fixture is kept for tests). A test that mocks a signed-in user by role name
 * gets the same `user.access` the server would send for that role.
 */
import matrix from '../lib/accessMatrix.json'

export function seededAccess(roleName) {
  const features = {}
  const hidden = []
  for (const [key, area] of Object.entries(matrix.areas)) {
    if (area.offered.includes(roleName)) features[key] = 'view'
    else if (area.direct.includes(roleName)) { features[key] = 'view'; hidden.push(key) }
  }
  for (const [key, f] of Object.entries(matrix.features)) {
    if (f.edit.includes(roleName)) features[key] = 'edit'
    else if (f.view.includes(roleName)) features[key] = 'view'
    else continue
    if (f.hidden.includes(roleName)) hidden.push(key)
  }
  return {
    features,
    hidden_in_menus: hidden,
    exceptions: [],
    landing: matrix.landings[roleName] || 'standard',
    role: roleName,
    data_scope_type: matrix.data_scope[roleName] || 'none',
  }
}

/** A user with `access` filled from the fixture when the test gave none. */
export function userWithAccess(user) {
  if (!user || user.access || !user.role?.name) return user
  return { ...user, access: seededAccess(user.role.name) }
}

/** An AuthContext value whose user carries access. */
export function withSeededAccess(auth) {
  if (!auth || !auth.user) return auth
  return { ...auth, user: userWithAccess(auth.user) }
}
