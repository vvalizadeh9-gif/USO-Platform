"""UEP-25: feature access managed in Admin > Access.

* **Day one.** The migrated tables reproduce ``access_matrix.json`` exactly,
  role by role, and ``/me/access`` for every seeded role answers the same.
* **effective_level.** Override beats role; an expired override is ignored;
  a 'none' override removes a feature.
* **The cache** keeps its answer until ``access_version`` changes, and checks
  the version at most every 30 seconds.
* **Every route has a feature check**, or is on the explicit allow-list below.
* **Safety rules** (brief 4.6): data area never widened, Admin can't be
  locked out, outcome rules, expired exceptions removed, explicit grants only.
* **The brief's scenarios**: Explorer for one contractor with a reason;
  CPO from Viewer; removing Explorer hides it and the API refuses; History;
  "View as this user"; PM and Viewer read only.

Run with:  cd backend && pytest tests/test_feature_access.py -q
"""
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_feature_access_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.routing import APIRoute  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core import access  # noqa: E402
from app.core.access import Feature  # noqa: E402
from tests.conftest import create_schema  # noqa: E402

API = "/api/v1"
MATRIX = json.loads(access.MATRIX_PATH.read_text(encoding="utf-8"))
ROLES = list(MATRIX["data_scope"])


def expected_grants(role: str) -> dict[str, tuple[str, bool]]:
    """feature -> (level, hidden_in_menus), from the seed fixture."""
    out: dict[str, tuple[str, bool]] = {}
    for key, area in MATRIX["areas"].items():
        if role in area["offered"]:
            out[key] = ("view", False)
        elif role in area["direct"]:
            out[key] = ("view", True)
    for key, f in MATRIX["features"].items():
        if role in f["edit"]:
            out[key] = ("edit", role in f["hidden"])
        elif role in f["view"]:
            out[key] = ("view", role in f["hidden"])
    return out


# --------------------------------------------------------------------------
# World: a fresh schema, one account per built-in role, two contractors' sites
# --------------------------------------------------------------------------
@pytest.fixture(scope="module")
def world():
    path = "/tmp/uep_feature_access_pytest.db"
    if os.path.exists(path):
        os.remove(path)
    create_schema()
    from app.core.bootstrap import init_db

    init_db()
    from app.core import user_status
    from app.core.database import SessionLocal
    from app.core.security import create_access_token
    from app.main import app
    from app.models.reference import Contractor, Province, Role, User
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    roles = {r.name: r for r in db.query(Role).all()}
    province = db.query(Province).order_by(Province.id).first()
    co_a = Contractor(name="Alpha DT", type="drive_test")
    co_b = Contractor(name="Beta DT", type="drive_test")
    db.add_all([co_a, co_b])
    db.flush()

    def site(code, contractor):
        s = Site(site_code=code, province_id=province.id)
        db.add(s)
        db.flush()
        wi = WorkItem(site_id=s.id, site_type="Greenfield", dt_status="Done",
                      requested_technology="3G", dt_sc_contractor_id=contractor.id,
                      current_stage="DT Done")
        db.add(wi)
        db.flush()
        return wi

    own = site("FA100", co_a)
    rival = site("FA200", co_b)

    def user(username, role, **kw):
        u = User(username=username, password_hash="x", first_name=username, family_name="T",
                 role_id=roles[role].id, status=user_status.ACTIVE, **kw)
        db.add(u)
        db.flush()
        return u

    accounts = {}
    for role in ROLES:
        kw = {"sees_all_provinces": True}
        if role == "Contractor":
            kw = {"sees_all_provinces": False, "contractor_id": co_a.id}
        accounts[role] = user(f"fa_{role.lower()}", role, **kw)
    accounts["Admin2"] = user("fa_admin2", "Admin", sees_all_provinces=True)
    db.commit()

    def headers(u):
        return {"Authorization": f"Bearer {create_access_token(u.id, {'ver': u.token_version})}"}

    out = {
        "client": TestClient(app),
        "app": app,
        "h": {name: headers(u) for name, u in accounts.items()},
        "ids": {name: u.id for name, u in accounts.items()},
        "roles": {name: r.id for name, r in roles.items()},
        "own": own.id,
        "rival": rival.id,
        "headers_for": headers,
        "SessionLocal": SessionLocal,
    }
    db.close()
    return out


def _get(world, who, path, **params):
    return world["client"].get(f"{API}{path}", headers=world["h"][who], params=params)


def _put(world, who, path, body):
    return world["client"].put(f"{API}{path}", headers=world["h"][who], json=body)


# --------------------------------------------------------------------------
# 1. Day one: same access as before
# --------------------------------------------------------------------------
def test_feature_enum_equals_the_catalogue(world):
    from app.models.access import Feature as Row

    db = world["SessionLocal"]()
    try:
        keys = {r.key for r in db.query(Row).all()}
    finally:
        db.close()
    assert keys == {f.value for f in Feature}
    assert keys == set(MATRIX["areas"]) | set(MATRIX["features"])


@pytest.mark.parametrize("role", ROLES)
def test_migrated_grants_reproduce_the_matrix(world, role):
    from app.models.access import RoleFeatureGrant

    db = world["SessionLocal"]()
    try:
        rows = db.query(RoleFeatureGrant).filter_by(role_id=world["roles"][role]).all()
        got = {g.feature_key: (g.level, g.hidden_in_menus) for g in rows}
    finally:
        db.close()
    assert got == expected_grants(role)


@pytest.mark.parametrize("role", ROLES)
def test_me_access_equals_the_matrix_for_every_role(world, role):
    r = _get(world, role, "/me/access")
    assert r.status_code == 200, r.text
    body = r.json()
    want = expected_grants(role)
    assert body["features"] == {k: lv for k, (lv, _) in want.items()}
    assert set(body["hidden_in_menus"]) == {k for k, (_, hidden) in want.items() if hidden}
    assert body["landing"] == MATRIX["landings"].get(role, "standard")
    assert body["data_scope_type"] == MATRIX["data_scope"][role]


def test_system_roles_are_marked_and_scoped(world):
    from app.models.reference import Role

    db = world["SessionLocal"]()
    try:
        for name in ROLES:
            role = db.query(Role).filter_by(name=name).one()
            assert role.is_system
            assert role.data_scope_type == MATRIX["data_scope"][name]
    finally:
        db.close()


# --------------------------------------------------------------------------
# 2. effective_level and the cache
# --------------------------------------------------------------------------
def _session_user(world, who):
    from app.models.reference import User

    db = world["SessionLocal"]()
    return db, db.get(User, world["ids"][who])


def test_override_beats_role_and_expiry_is_ignored(world):
    from app.models.access import UserFeatureOverride

    db, user = _session_user(world, "Viewer")
    try:
        assert access.effective_level(user, Feature.EXPLORER, db) == "view"
        o = UserFeatureOverride(user_id=user.id, feature_key="explorer", level="none", reason="t")
        db.add(o)
        access.bump_version(db)
        db.commit()
        assert access.effective_level(user, Feature.EXPLORER, db) == "none"
        o.level = "view"
        o.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.add(UserFeatureOverride(user_id=user.id, feature_key="plan_approvals", level="edit",
                                   reason="t", expires_at=datetime.now(timezone.utc) + timedelta(days=1)))
        access.bump_version(db)
        db.commit()
        # Expired: back to the role's grant. Live: the override.
        assert access.effective_level(user, Feature.EXPLORER, db) == "view"
        assert access.effective_level(user, Feature.PLAN_APPROVALS, db) == "edit"
    finally:
        db.query(UserFeatureOverride).filter_by(user_id=user.id).delete()
        access.bump_version(db)
        db.commit()
        db.close()


def test_cache_refreshes_only_when_the_version_changes(world, monkeypatch):
    from app.models.access import RoleFeatureGrant
    from sqlalchemy import update

    clock = [1000.0]
    monkeypatch.setattr(access.time, "monotonic", lambda: clock[0])
    db, user = _session_user(world, "Viewer")
    try:
        access.invalidate()
        assert access.has(user, Feature.EXPLORER, db=db)
        # Another pod removes the grant and bumps the version.
        db.query(RoleFeatureGrant).filter_by(role_id=user.role_id, feature_key="explorer").delete()
        db.execute(update(access.AccessVersion).values(version=access.AccessVersion.version + 1))
        db.commit()
        clock[0] += 10  # Inside 30 s: this pod still answers from its cache.
        assert access.has(user, Feature.EXPLORER, db=db)
        clock[0] += 25  # Past 30 s: it reads the version, sees it moved, re-reads.
        assert not access.has(user, Feature.EXPLORER, db=db)
        # No version change: no re-read even after a long time.
        db.add(RoleFeatureGrant(role_id=user.role_id, feature_key="explorer", level="view"))
        db.commit()
        clock[0] += 100
        assert not access.has(user, Feature.EXPLORER, db=db)
    finally:
        if not db.query(RoleFeatureGrant).filter_by(role_id=user.role_id, feature_key="explorer").first():
            db.add(RoleFeatureGrant(role_id=user.role_id, feature_key="explorer", level="view"))
        access.bump_version(db)
        db.commit()
        db.close()
        access.invalidate()


# --------------------------------------------------------------------------
# 3. Every route has a feature check, or is on the allow-list
# --------------------------------------------------------------------------
#: Routes with no feature check, each for a stated reason. Anything new must
#: either use require_access or be added here on purpose.
ALLOW_LIST = {
    # Signing in and out, one's own profile and password.
    "/api/v1/auth/captcha", "/api/v1/auth/login", "/api/v1/auth/logout", "/api/v1/auth/me",
    "/api/v1/auth/me/password", "/api/v1/auth/refresh", "/api/v1/auth/session",
    "/api/v1/auth/forgot-password", "/api/v1/auth/password-reset-request",
    # The sign-in page's public contact and notice (UEP-26): read before sign-in.
    "/api/v1/auth/signin-settings",
    # What the signed-in user may use; their Home; their notifications.
    "/api/v1/me/access", "/api/v1/me/home", "/api/v1/home/summary",
    "/api/v1/me/notifications", "/api/v1/notifications/{notification_id}/read",
    # Reference lists every form reads.
    "/api/v1/reference/provinces", "/api/v1/reference/roles", "/api/v1/reference/contractors",
    "/api/v1/reference/problem-categories", "/api/v1/reference/coordinators",
    "/api/v1/reference/regional-managers",
    # Header search: every hit is row-scoped by services/visibility.py.
    "/api/v1/search",
    # Browser error reports.
    "/api/v1/client-errors",
    # Row-scoped reads every role with sites uses (services/visibility.py).
    "/api/v1/work-items", "/api/v1/work-items/counts", "/api/v1/work-items/{work_item_id}",
    "/api/v1/hc/assignments/{assignment_id}", "/api/v1/hc/my/assignments",
    "/api/v1/hc/sites/{work_item_id}/history", "/api/v1/hc/assignments/{assignment_id}/template",
    "/api/v1/drive-tests/evidence/{evidence_id}/download",
    "/api/v1/acceptance/evidence/{evidence_id}/download",
    # Fix closing and re-routing: the owner of the remediation's category,
    # decided against the row (a workflow rule, not a feature).
    "/api/v1/hc/fixes/{remediation_id}/close", "/api/v1/hc/fixes/{remediation_id}/reroute",
    # Dashboards and KPI reads that check their area inside (services/kpi.py,
    # services/gaps.py) or via a router-level DASHBOARD_READER dependency.
    "/api/v1/kpi/month", "/api/v1/kpi/area", "/api/v1/kpi/lenses", "/api/v1/kpi/summary",
    "/api/v1/kpi/contractors",
    "/api/v1/gaps/overview", "/api/v1/gaps/map",
    # Acceptance: row-scoped reads and the cases update, which checks the
    # case's basket against the user (UEP-22).
    "/api/v1/acceptance/limits", "/api/v1/acceptance/villages/bucket-counts",
    "/api/v1/acceptance/villages", "/api/v1/acceptance/cases/update",
    "/api/v1/acceptance/categories", "/api/v1/acceptance/plan",
    # Validation evidence: the submission's own scope.
    "/api/v1/my-work/evidence/{evidence_id}", "/api/v1/my-work/evidence/{evidence_id}/download",
    "/api/v1/my-work/evidence/{evidence_id}/email",
    "/api/v1/my-work/evidence/{evidence_id}/email/attachments/{index}",
    "/api/v1/my-work/letters/evidence.zip",
    # Monthly plan: scorecard and revisions scope to the contractor inside.
    "/api/v1/pip/scorecard", "/api/v1/pip/revisions",
    # Submissions: services/submissions/scope.py checks the area and who may act.
    "/api/v1/submissions", "/api/v1/submissions/villages", "/api/v1/submissions/batches",
    "/api/v1/submissions/batches/{number}", "/api/v1/submissions/owner",
    "/api/v1/submissions/owner/candidates",
}


def _checks(dependant) -> bool:
    if getattr(dependant.call, "feature", None) is not None:
        return True
    return any(_checks(d) for d in dependant.dependencies)


def test_every_route_has_a_feature_check_or_an_allow_list_entry(world):
    missing = []
    for route in world["app"].routes:
        if not isinstance(route, APIRoute) or not route.path.startswith(API):
            continue
        if _checks(route.dependant):
            continue
        if route.path in ALLOW_LIST or route.path.startswith(f"{API}/submissions"):
            continue
        # Router-level checks inside services (dashboards read through a
        # DASHBOARD_READER dependency, which is a require_access guard).
        missing.append(f"{sorted(route.methods)} {route.path}")
    assert not missing, "Routes with no feature check:\n" + "\n".join(sorted(missing))


# --------------------------------------------------------------------------
# 4. The brief's scenarios
# --------------------------------------------------------------------------
def test_explorer_for_one_contractor_never_widens_rows(world):
    uid = world["ids"]["Contractor"]
    assert _get(world, "Contractor", "/explorer/sites").status_code == 200  # Already offered.
    # Take it away by exception, then give it back by exception with a reason.
    r = _put(world, "Admin", f"/admin/access/users/{uid}/overrides/explorer",
             {"level": "none", "reason": "Pilot"})
    assert r.status_code == 200, r.text
    assert _get(world, "Contractor", "/explorer/sites").status_code == 403
    assert "explorer" not in _get(world, "Contractor", "/me/access").json()["features"]
    r = _put(world, "Admin", f"/admin/access/users/{uid}/overrides/explorer",
             {"level": "view", "reason": "Needs to check its own sites"})
    assert r.status_code == 200, r.text
    body = _get(world, "Contractor", "/me/access").json()
    assert body["features"]["explorer"] == "view" and "explorer" in body["exceptions"]
    listed = _get(world, "Contractor", "/explorer/sites", limit=100).json()
    ids = {row["id"] for row in listed["items"]}
    assert world["own"] in ids and world["rival"] not in ids
    assert _get(world, "Contractor", f"/explorer/sites/{world['rival']}").status_code in (403, 404)
    world["client"].delete(f"{API}/admin/access/users/{uid}/overrides/explorer",
                           headers=world["h"]["Admin"])


def test_explorer_all_sites_is_never_given_to_a_contractor(world):
    uid = world["ids"]["Contractor"]
    r = _put(world, "Admin", f"/admin/access/users/{uid}/overrides/explorer_all_sites",
             {"level": "view", "reason": "x"})
    assert r.status_code == 422 and "widen" in r.json()["detail"]
    r = _put(world, "Admin", f"/admin/access/roles/{world['roles']['Coordinator']}",
             {"grants": {"explorer_all_sites": "view"}})
    assert r.status_code == 422


def test_cpo_from_viewer_signs_in_with_exactly_the_granted_features(world):
    from app.core.security import create_access_token
    from tests.conftest import login_form

    client = world["client"]
    r = client.post(f"{API}/admin/access/roles", headers=world["h"]["Admin"],
                    json={"source_role_id": world["roles"]["Viewer"], "name": "CPO"})
    assert r.status_code == 201, r.text
    cpo = r.json()
    assert not cpo["is_system"] and cpo["grants"] == {
        k: lv for k, (lv, _) in expected_grants("Viewer").items()}
    r = _put(world, "Admin", f"/admin/access/roles/{cpo['id']}",
             {"landing": "/explorer", "grants": {"exports": "none"}})
    assert r.status_code == 200, r.text
    assert r.json()["summary"]["removed"] == ["exports"]
    r = client.post(f"{API}/admin/users", headers=world["h"]["Admin"], json={
        "username": "fa_cpo", "password": "Cpo-Passw0rd-2026!", "first_name": "Chief",
        "family_name": "Officer", "role_id": cpo["id"], "sees_all_provinces": True,
        "province_ids": []})
    assert r.status_code == 201, r.text
    signed = client.post(f"{API}/auth/login", data=login_form(client, "fa_cpo", "Cpo-Passw0rd-2026!"))
    assert signed.status_code == 200, signed.text
    h = {"Authorization": f"Bearer {signed.cookies['uep_session']}"}
    me = client.get(f"{API}/me/access", headers=h).json()
    want = {k: lv for k, (lv, _) in expected_grants("Viewer").items() if k != "exports"}
    assert me["features"] == want and me["landing"] == "/explorer" and me["role"] == "CPO"
    assert client.get(f"{API}/explorer/sites/export", headers=h).status_code == 403
    assert client.get(f"{API}/explorer/sites", headers=h).status_code == 200
    del create_access_token


def test_removing_explorer_from_a_role_refuses_the_api(world):
    rid = world["roles"]["RegionalManager"]
    assert _get(world, "RegionalManager", "/explorer/sites").status_code == 200
    r = _put(world, "Admin", f"/admin/access/roles/{rid}", {"grants": {"explorer": "none"}})
    assert r.status_code == 200, r.text
    assert _get(world, "RegionalManager", "/explorer/sites").status_code == 403
    assert "explorer" not in _get(world, "RegionalManager", "/me/access").json()["features"]
    _put(world, "Admin", f"/admin/access/roles/{rid}", {"grants": {"explorer": "view"}})
    assert _get(world, "RegionalManager", "/explorer/sites").status_code == 200


def test_temporary_exception_expires_on_its_date(world):
    from app.models.access import UserFeatureOverride
    from app.services import access_admin

    uid = world["ids"]["Viewer"]
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    r = _put(world, "Admin", f"/admin/access/users/{uid}/overrides/plan_approvals",
             {"level": "edit", "reason": "Covering for the PM", "expires_on": tomorrow})
    assert r.status_code == 200, r.text
    assert _get(world, "Viewer", "/me/access").json()["features"]["plan_approvals"] == "edit"
    db = world["SessionLocal"]()
    try:
        removed = access_admin.expire_overrides(db, datetime.now(timezone.utc) + timedelta(days=2))
        db.commit()
        assert removed == 1
        assert db.query(UserFeatureOverride).filter_by(user_id=uid).count() == 0
    finally:
        db.close()
    access.invalidate()
    assert "plan_approvals" not in _get(world, "Viewer", "/me/access").json()["features"]
    history = _get(world, "Admin", "/admin/access/history").json()["items"]
    assert any(h["action"] == "access.user_override_expired" for h in history)


# --------------------------------------------------------------------------
# 5. Safety rules
# --------------------------------------------------------------------------
@pytest.mark.parametrize("feature", ["users", "access"])
def test_admin_role_cannot_lose_users_or_access(world, feature):
    r = _put(world, "Admin", f"/admin/access/roles/{world['roles']['Admin']}",
             {"grants": {feature: "view"}})
    assert r.status_code == 422 and "locked out" in r.json()["detail"]


def test_last_admin_cannot_be_locked_out(world):
    # Taking Access from the other admins is allowed; from the last one, refused.
    from app.models.reference import Role, User

    db = world["SessionLocal"]()
    try:
        others = [u.id for u in db.query(User).join(User.role).filter(Role.name == "Admin")
                  if u.id != world["ids"]["Admin"]]
    finally:
        db.close()
    assert others
    for uid in others:
        r = _put(world, "Admin", f"/admin/access/users/{uid}/overrides/access",
                 {"level": "view", "reason": "Read only for a while"})
        assert r.status_code == 200, r.text
    r = _put(world, "Admin", f"/admin/access/users/{world['ids']['Admin']}/overrides/users",
             {"level": "none", "reason": "x"})
    assert r.status_code == 422 and "last active Admin" in r.json()["detail"]
    for uid in others:
        world["client"].delete(f"{API}/admin/access/users/{uid}/overrides/access",
                               headers=world["h"]["Admin"])


@pytest.mark.parametrize("feature", ["acceptance_filing", "acceptance_approve"])
def test_team_basket_roles_cannot_get_outcome_edit(world, feature):
    r = _put(world, "Admin", f"/admin/access/roles/{world['roles']['CpgPso']}",
             {"grants": {feature: "edit"}})
    assert r.status_code == 422 and "Team baskets" in r.json()["detail"]
    r = _put(world, "Admin", f"/admin/access/users/{world['ids']['NwgPlanning']}/overrides/{feature}",
             {"level": "edit", "reason": "x"})
    assert r.status_code == 422


def test_admin_gets_no_workflow_edit_implicitly(world):
    body = _get(world, "Admin", "/me/access").json()["features"]
    for key in ("hc_work", "dt_review", "acceptance_filing", "plan_approvals", "field_results"):
        assert body.get(key) in (None, "view"), key
    assert world["client"].post(f"{API}/hc/assignments", headers=world["h"]["Admin"],
                                json={}).status_code == 403


def test_levels_a_feature_does_not_support_are_refused(world):
    r = _put(world, "Admin", f"/admin/access/roles/{world['roles']['PM']}",
             {"grants": {"audit_log": "edit"}})
    assert r.status_code == 422


def test_system_role_cannot_be_deleted_nor_a_role_with_users(world):
    client = world["client"]
    r = client.delete(f"{API}/admin/access/roles/{world['roles']['Viewer']}", headers=world["h"]["Admin"])
    assert r.status_code == 422
    made = client.post(f"{API}/admin/access/roles", headers=world["h"]["Admin"],
                       json={"source_role_id": world["roles"]["Viewer"], "name": "Temp role"}).json()
    r = client.delete(f"{API}/admin/access/roles/{made['id']}", headers=world["h"]["Admin"])
    assert r.status_code == 204
    history = _get(world, "Admin", "/admin/access/history").json()["items"]
    assert {"access.role_created", "access.role_deleted"} <= {h["action"] for h in history}


# --------------------------------------------------------------------------
# 6. History, View as, read only
# --------------------------------------------------------------------------
def test_history_has_who_before_after_and_reason(world):
    uid = world["ids"]["Coordinator"]
    _put(world, "Admin", f"/admin/access/users/{uid}/overrides/kpi_mapping",
         {"level": "view", "reason": "Audit week"})
    items = _get(world, "Admin", "/admin/access/history").json()["items"]
    entry = next(i for i in items if i["action"] == "access.user_override_changed"
                 and i["after"]["feature"] == "kpi_mapping")
    assert entry["who"] and entry["reason"] == "Audit week"
    assert entry["before"]["effective"] == "none" and entry["after"]["effective"] == "view"
    world["client"].delete(f"{API}/admin/access/users/{uid}/overrides/kpi_mapping",
                           headers=world["h"]["Admin"])


def test_view_as_user_is_admin_only_and_read_only(world):
    uid = world["ids"]["Contractor"]
    r = _get(world, "Admin", f"/admin/access/users/{uid}/preview")
    assert r.status_code == 200, r.text
    assert r.json()["access"]["features"] == _get(world, "Contractor", "/me/access").json()["features"]
    assert _get(world, "PM", f"/admin/access/users/{uid}/preview").status_code == 403


@pytest.mark.parametrize("who", ["PM", "Viewer"])
def test_pm_and_viewer_read_access_but_cannot_change_it(world, who):
    assert _get(world, who, "/admin/access/roles").status_code == 200
    assert _get(world, who, "/admin/access/features").status_code == 200
    assert _get(world, who, f"/admin/access/users/{world['ids']['Contractor']}").status_code == 200
    r = _put(world, who, f"/admin/access/roles/{world['roles']['Viewer']}", {"grants": {"explorer": "none"}})
    assert r.status_code == 403


@pytest.mark.parametrize("who", ["Contractor", "Coordinator"])
def test_others_cannot_read_access(world, who):
    assert _get(world, who, "/admin/access/roles").status_code == 403
