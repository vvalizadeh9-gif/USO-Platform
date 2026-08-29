"""The user management module: identity, status, passwords and the audit trail.

Four things are being checked here, and they are the four the module exists
for.

**Identity.** A user is a first name, a family name, an email address, a
username and a password hash -- and never a password. Nothing in the API can be
made to return one, because there is nothing to return.

**Status.** Active, Inactive and Suspended, with no route that deletes a user
row. The guard against locking every administrator out has to hold on every
route that can take an account offline, not just the one somebody remembered.

**Passwords.** Argon2id, changed by their owner, reset by an administrator, and
in the reset case usable for exactly one thing until replaced.

**The audit trail.** Every authentication event and every account event lands
in ``audit_logs`` with a named action and a result, including the ones that
failed -- and nothing in the API can edit or remove an entry afterwards.

Run with:  cd backend && pytest tests/test_user_management.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_usermgmt_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from tests.conftest import create_schema, login_form  # noqa: E402

PASSWORD = "Users-Module-Passw0rd"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_usermgmt_pytest.db"):
        os.remove("/tmp/uep_usermgmt_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _reset_throttle() -> None:
    """Clear the login-attempt counters.

    Several tests here sign in wrongly on purpose, and the throttle is durable,
    so without this the fifth deliberate failure locks out the sixth test.
    """
    from app.core.database import SessionLocal
    from app.core.rate_limit import login_rate_limiter

    db = SessionLocal()
    try:
        login_rate_limiter.reset(db)
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _clean_throttle():
    _reset_throttle()
    yield
    _reset_throttle()


@pytest.fixture(scope="module")
def admin_headers(client):
    r = client.post("/api/v1/auth/login", data=login_form(client))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _role_id(client, admin_headers, name="Viewer") -> int:
    roles = client.get("/api/v1/reference/roles", headers=admin_headers).json()
    return next(r["id"] for r in roles if r["name"] == name)


def _create(client, admin_headers, username, **overrides) -> dict:
    payload = {
        "username": username,
        "password": PASSWORD,
        "first_name": "Zahra",
        "family_name": "Karimi",
        "role_id": _role_id(client, admin_headers),
        "sees_all_provinces": True,
        "province_ids": [],
    }
    payload.update(overrides)
    r = client.post("/api/v1/admin/users", headers=admin_headers, json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _login(client, username, password=PASSWORD):
    return client.post("/api/v1/auth/login", data=login_form(client, username, password))


def _headers(client, username, password=PASSWORD) -> dict:
    r = _login(client, username, password)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _audit(client, admin_headers, **params) -> list[dict]:
    r = client.get("/api/v1/admin/audit-logs", headers=admin_headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()["items"]


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------
def test_a_user_has_two_name_fields_and_a_derived_full_name(client, admin_headers):
    """One column holding two facts is what this replaced."""
    user = _create(client, admin_headers, "um_named", first_name="Ali Reza",
                   family_name="Ahmadi")

    assert user["first_name"] == "Ali Reza"
    assert user["family_name"] == "Ahmadi"
    assert user["full_name"] == "Ali Reza Ahmadi"


def test_an_email_address_is_normalised_and_unique(client, admin_headers):
    user = _create(client, admin_headers, "um_email", email="  Zahra@Example.COM ")
    assert user["email"] == "zahra@example.com"

    clash = client.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json={
            "username": "um_email_clash",
            "password": PASSWORD,
            "first_name": "Other",
            "family_name": "Person",
            "email": "zahra@example.com",
            "role_id": _role_id(client, admin_headers),
            "sees_all_provinces": True,
            "province_ids": [],
        },
    )
    assert clash.status_code == 400
    assert "email" in clash.json()["detail"].lower()


def test_a_malformed_email_is_refused_with_a_readable_message(client, admin_headers):
    r = client.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json={
            "username": "um_bad_email",
            "password": PASSWORD,
            "first_name": "A",
            "family_name": "B",
            "email": "not-an-address",
            "role_id": _role_id(client, admin_headers),
            "sees_all_provinces": True,
            "province_ids": [],
        },
    )
    assert r.status_code == 422
    assert "email address" in str(r.json()["detail"])


def test_no_endpoint_ever_returns_a_password_or_its_hash(client, admin_headers):
    """The strongest form of "never expose the existing password"."""
    _create(client, admin_headers, "um_no_hash")

    bodies = [
        client.get("/api/v1/admin/users", headers=admin_headers).text,
        client.get("/api/v1/auth/me", headers=admin_headers).text,
        client.get("/api/v1/admin/audit-logs", headers=admin_headers).text,
    ]
    for body in bodies:
        assert "password_hash" not in body
        assert "$argon2" not in body
        assert PASSWORD not in body


def test_users_can_be_searched_and_filtered(client, admin_headers):
    _create(client, admin_headers, "um_search_one", first_name="Mahdi",
            family_name="Rostami")
    _create(client, admin_headers, "um_search_two", first_name="Sara",
            family_name="Rostami", status="Suspended")

    by_name = client.get(
        "/api/v1/admin/users", headers=admin_headers, params={"search": "rostami"}
    ).json()
    assert {u["username"] for u in by_name} == {"um_search_one", "um_search_two"}

    # Case-insensitively, and on the username as well as the name.
    by_username = client.get(
        "/api/v1/admin/users", headers=admin_headers, params={"search": "UM_SEARCH_ONE"}
    ).json()
    assert [u["username"] for u in by_username] == ["um_search_one"]

    suspended = client.get(
        "/api/v1/admin/users", headers=admin_headers, params={"status": "Suspended"}
    ).json()
    assert "um_search_two" in {u["username"] for u in suspended}
    assert "um_search_one" not in {u["username"] for u in suspended}


def test_an_unknown_status_filter_is_refused_rather_than_silently_empty(
    client, admin_headers
):
    r = client.get(
        "/api/v1/admin/users", headers=admin_headers, params={"status": "Dormant"}
    )
    assert r.status_code == 400
    assert "Suspended" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------
def test_the_three_statuses_round_trip(client, admin_headers):
    user = _create(client, admin_headers, "um_status")
    assert user["status"] == "Active"

    for status in ("Suspended", "Inactive", "Active"):
        r = client.post(
            f"/api/v1/admin/users/{user['id']}/status",
            headers=admin_headers,
            json={"status": status, "reason": f"moving to {status}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == status
        assert r.json()["active"] is (status == "Active")


def test_a_fourth_status_is_refused_at_the_edge(client, admin_headers):
    user = _create(client, admin_headers, "um_status_bad")
    r = client.post(
        f"/api/v1/admin/users/{user['id']}/status",
        headers=admin_headers,
        json={"status": "Retired"},
    )
    assert r.status_code == 422


@pytest.mark.parametrize("status", ["Inactive", "Suspended"])
def test_a_non_active_account_cannot_sign_in_and_is_told_why(
    client, admin_headers, status
):
    """The two refusals must read differently, or the status means nothing.

    Someone told "inactive" knows their account was closed; someone told
    "suspended" knows a decision was made about them. Collapsing both into one
    message is the boolean this replaced.
    """
    username = f"um_signin_{status.lower()}"
    user = _create(client, admin_headers, username)
    assert _login(client, username).status_code == 200

    client.post(
        f"/api/v1/admin/users/{user['id']}/status",
        headers=admin_headers,
        json={"status": status},
    )

    refused = _login(client, username)
    assert refused.status_code == 403, refused.text
    assert status.lower() in refused.json()["detail"].lower()


def test_suspension_ends_the_sessions_the_account_already_has(client, admin_headers):
    """Withdrawing access should take effect now, not when a token expires."""
    user = _create(client, admin_headers, "um_suspend_session")
    headers = _headers(client, "um_suspend_session")
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200

    client.post(
        f"/api/v1/admin/users/{user['id']}/status",
        headers=admin_headers,
        json={"status": "Suspended"},
    )
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_a_suspended_user_is_still_listed_and_still_named_in_history(
    client, admin_headers
):
    """Nothing is deleted, which is the point of statuses over deletion."""
    user = _create(client, admin_headers, "um_kept")
    client.post(
        f"/api/v1/admin/users/{user['id']}/status",
        headers=admin_headers,
        json={"status": "Suspended"},
    )

    listed = client.get("/api/v1/admin/users", headers=admin_headers).json()
    kept = next(u for u in listed if u["id"] == user["id"])
    assert kept["status"] == "Suspended"
    assert kept["full_name"] == "Zahra Karimi"
    assert kept["status_changed_at"] is not None
    assert kept["status_changed_by"] is not None


def test_reactivating_clears_the_status_change_record(client, admin_headers):
    user = _create(client, admin_headers, "um_reactivate")
    for status in ("Suspended", "Active"):
        client.post(
            f"/api/v1/admin/users/{user['id']}/status",
            headers=admin_headers,
            json={"status": status},
        )

    again = client.get(f"/api/v1/admin/users/{user['id']}", headers=admin_headers).json()
    assert again["status"] == "Active"
    assert again["status_changed_at"] is None, "a live account must not look suspended"
    assert again["status_changed_by"] is None
    assert _login(client, "um_reactivate").status_code == 200


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------
def test_a_bcrypt_hash_is_upgraded_to_argon2id_on_the_next_sign_in(
    client, admin_headers
):
    """The old format drains away as people sign in, with nothing to administer.

    Rewriting every hash at deploy time is impossible -- the plaintexts do not
    exist -- and asking everyone to reset would be a platform-wide outage. The
    one moment a hash can be upgraded is the moment its password is verified.
    """
    from app.core.database import SessionLocal
    from app.models.reference import User

    _create(client, admin_headers, "um_legacy_hash")

    # Put a genuine bcrypt hash of the same password in the column, the way a
    # row written before the switch looks.
    import bcrypt

    legacy = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt(rounds=4)).decode()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == "um_legacy_hash").one()
        user.password_hash = legacy
        db.commit()
    finally:
        db.close()

    assert _login(client, "um_legacy_hash").status_code == 200, (
        "a password set before the switch must still work"
    )

    db = SessionLocal()
    try:
        upgraded = db.query(User).filter(User.username == "um_legacy_hash").one()
        assert upgraded.password_hash.startswith("$argon2id$")
    finally:
        db.close()

    # And the upgraded hash still verifies the same password.
    assert _login(client, "um_legacy_hash").status_code == 200


def test_an_admin_reset_returns_a_temporary_password_once(client, admin_headers):
    user = _create(client, admin_headers, "um_reset")

    r = client.post(
        f"/api/v1/admin/users/{user['id']}/reset-password",
        headers=admin_headers,
        json={},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["username"] == "um_reset"
    assert body["must_change_password"] is True
    assert len(body["temporary_password"]) >= 12

    # It is a real credential, and the old one is gone.
    assert _login(client, "um_reset").status_code == 401
    assert _login(client, "um_reset", body["temporary_password"]).status_code == 200


def test_a_temporary_password_can_only_be_used_to_replace_itself(
    client, admin_headers
):
    user = _create(client, admin_headers, "um_forced_change")
    temporary = client.post(
        f"/api/v1/admin/users/{user['id']}/reset-password",
        headers=admin_headers,
        json={},
    ).json()["temporary_password"]

    headers = _headers(client, "um_forced_change", temporary)

    # Reading your own profile and signing out stay open; everything else does
    # not, and says why in a form the frontend can act on.
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    blocked = client.get("/api/v1/action-center", headers=headers)
    assert blocked.status_code == 403
    assert blocked.json()["detail"]["code"] == "password_change_required"

    changed = client.post(
        "/api/v1/auth/me/password",
        headers=headers,
        json={"current_password": temporary, "new_password": "a whole new passphrase"},
    )
    assert changed.status_code == 200, changed.text

    fresh = {"Authorization": f"Bearer {changed.json()['access_token']}"}
    assert client.get("/api/v1/action-center", headers=fresh).status_code == 200
    assert client.get("/api/v1/auth/me", headers=fresh).json()[
        "must_change_password"
    ] is False


def test_an_admin_supplied_password_is_held_to_the_same_policy(client, admin_headers):
    user = _create(client, admin_headers, "um_weak_reset")

    weak = client.post(
        f"/api/v1/admin/users/{user['id']}/reset-password",
        headers=admin_headers,
        json={"password": "short"},
    )
    assert weak.status_code == 422

    from_username = client.post(
        f"/api/v1/admin/users/{user['id']}/reset-password",
        headers=admin_headers,
        json={"password": "um_weak_reset_2024"},
    )
    assert from_username.status_code == 400
    assert "username" in from_username.json()["detail"]


def test_a_user_changes_their_own_password_and_keeps_working(client, admin_headers):
    _create(client, admin_headers, "um_self_change")
    headers = _headers(client, "um_self_change")

    r = client.post(
        "/api/v1/auth/me/password",
        headers=headers,
        json={"current_password": PASSWORD, "new_password": "another quiet village"},
    )
    assert r.status_code == 200, r.text
    # Handed a fresh token rather than signed out for succeeding.
    fresh = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/api/v1/auth/me", headers=fresh).status_code == 200
    assert _login(client, "um_self_change", "another quiet village").status_code == 200


def test_setting_a_password_is_not_part_of_the_general_user_edit(
    client, admin_headers
):
    """A credential reset and a corrected surname must not be the same call.

    They were, which made them indistinguishable in the audit log afterwards --
    exactly the distinction anybody reading it later needs.
    """
    user = _create(client, admin_headers, "um_patch_password")

    r = client.patch(
        f"/api/v1/admin/users/{user['id']}",
        headers=admin_headers,
        json={"first_name": "Renamed", "password": "sneaking one in here"},
    )
    # Refused outright, not accepted-and-ignored. An administrator who believes
    # they reset a password and did not is worse off than one told they cannot.
    assert r.status_code == 422, r.text
    assert "password" in str(r.json()["detail"])
    assert _login(client, "um_patch_password").status_code == 200, (
        "the password must be untouched by an ordinary edit"
    )

    # And the edit itself still works without it.
    ok = client.patch(
        f"/api/v1/admin/users/{user['id']}",
        headers=admin_headers,
        json={"first_name": "Renamed"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["first_name"] == "Renamed"


# ---------------------------------------------------------------------------
# The audit trail: authentication events
# ---------------------------------------------------------------------------
def test_a_successful_sign_in_is_recorded(client, admin_headers):
    _create(client, admin_headers, "um_audit_login")
    _headers(client, "um_audit_login")

    entries = _audit(client, admin_headers, action="LOGIN_SUCCESS")
    mine = [e for e in entries if e["username"] == "um_audit_login"]
    assert mine, "a successful sign-in must be recorded"
    assert mine[0]["result"] == "Success"
    assert mine[0]["module"] == "Auth"


def test_a_failed_sign_in_is_recorded_as_a_failure(client, admin_headers):
    """The entries that make the log worth keeping.

    A trail that holds only what worked cannot show anybody trying to get in,
    which is the first thing a reviewer looks for.
    """
    _create(client, admin_headers, "um_audit_badpass")
    assert _login(client, "um_audit_badpass", "definitely wrong").status_code == 401

    entries = _audit(client, admin_headers, action="LOGIN_FAILED")
    mine = [e for e in entries if e["username"] == "um_audit_badpass"]
    assert mine, "a refused sign-in must survive the 401 that follows it"
    assert mine[0]["result"] == "Failure"
    assert mine[0]["reason"] == "Incorrect password"


def test_a_sign_in_against_an_unknown_username_is_recorded_without_a_user(
    client, admin_headers
):
    """Someone working through a list of names looks different from a typo."""
    assert _login(client, "um_no_such_person", "whatever at all").status_code == 401

    entries = _audit(client, admin_headers, action="LOGIN_FAILED")
    mine = [
        e for e in entries
        if (e["new_value"] or {}).get("username") == "um_no_such_person"
    ]
    assert mine, "an attempt on a name nobody has is still an attempt"
    assert mine[0]["user_id"] is None
    assert mine[0]["result"] == "Failure"


def test_signing_in_to_a_suspended_account_is_recorded_with_the_status(
    client, admin_headers
):
    """The password was right, which is the part worth seeing."""
    user = _create(client, admin_headers, "um_audit_suspended")
    client.post(
        f"/api/v1/admin/users/{user['id']}/status",
        headers=admin_headers,
        json={"status": "Suspended"},
    )
    assert _login(client, "um_audit_suspended").status_code == 403

    entries = _audit(client, admin_headers, action="LOGIN_FAILED")
    mine = [e for e in entries if e["username"] == "um_audit_suspended"]
    assert mine
    assert "Suspended" in mine[0]["reason"]


def test_signing_out_is_recorded(client, admin_headers):
    _create(client, admin_headers, "um_audit_logout")
    headers = _headers(client, "um_audit_logout")

    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200

    entries = _audit(client, admin_headers, action="LOGOUT")
    assert any(e["username"] == "um_audit_logout" for e in entries)


def test_a_password_change_and_a_reset_are_recorded_separately(
    client, admin_headers
):
    user = _create(client, admin_headers, "um_audit_pw")
    headers = _headers(client, "um_audit_pw")
    client.post(
        "/api/v1/auth/me/password",
        headers=headers,
        json={"current_password": PASSWORD, "new_password": "the long way round"},
    )
    client.post(
        f"/api/v1/admin/users/{user['id']}/reset-password",
        headers=admin_headers,
        json={},
    )

    changed = _audit(client, admin_headers, action="PASSWORD_CHANGED")
    assert any(e["username"] == "um_audit_pw" for e in changed)

    reset = _audit(client, admin_headers, action="PASSWORD_RESET")
    mine = [e for e in reset if e["entity_id"] == user["id"]]
    assert mine, "an administrator resetting somebody else's password is an event"
    # Recorded against the administrator who did it, about the account it was
    # done to -- and never carrying the password itself.
    assert mine[0]["new_value"]["username"] == "um_audit_pw"
    assert "password" not in str(mine[0]["new_value"]).replace("username", "")


def test_the_ip_address_is_recorded(client, admin_headers):
    _create(client, admin_headers, "um_audit_ip")
    _headers(client, "um_audit_ip")

    entries = _audit(client, admin_headers, action="LOGIN_SUCCESS")
    mine = next(e for e in entries if e["username"] == "um_audit_ip")
    assert mine["ip_address"], "who, and from where"


# ---------------------------------------------------------------------------
# The audit trail: account events
# ---------------------------------------------------------------------------
def test_creating_a_user_is_recorded_with_the_new_values(client, admin_headers):
    user = _create(client, admin_headers, "um_audit_created")

    entries = _audit(client, admin_headers, action="USER_CREATED")
    mine = next(e for e in entries if e["entity_id"] == user["id"])
    assert mine["new_value"]["username"] == "um_audit_created"
    assert mine["new_value"]["status"] == "Active"
    assert "password_hash" not in mine["new_value"]


def test_an_edit_records_what_changed_on_both_sides(client, admin_headers):
    user = _create(client, admin_headers, "um_audit_edited")
    client.patch(
        f"/api/v1/admin/users/{user['id']}",
        headers=admin_headers,
        json={"family_name": "Mousavi"},
    )

    entries = _audit(client, admin_headers, action="USER_UPDATED")
    mine = next(e for e in entries if e["entity_id"] == user["id"])
    assert mine["old_value"]["family_name"] == "Karimi"
    assert mine["new_value"]["family_name"] == "Mousavi"
    assert "family_name" in mine["reason"]


@pytest.mark.parametrize(
    "status,expected_action",
    [
        ("Suspended", "USER_SUSPENDED"),
        ("Inactive", "USER_DEACTIVATED"),
    ],
)
def test_each_status_change_has_its_own_action(
    client, admin_headers, status, expected_action
):
    user = _create(client, admin_headers, f"um_audit_moved_{status.lower()}")
    client.post(
        f"/api/v1/admin/users/{user['id']}/status",
        headers=admin_headers,
        json={"status": status, "reason": "because"},
    )

    entries = _audit(client, admin_headers, action=expected_action)
    mine = next(e for e in entries if e["entity_id"] == user["id"])
    assert mine["old_value"]["status"] == "Active"
    assert mine["new_value"]["status"] == status
    assert mine["reason"] == "because"


def test_coming_back_from_suspension_is_a_reactivation(client, admin_headers):
    """Distinct from activation, because the requirements name both."""
    user = _create(client, admin_headers, "um_audit_reactivated")
    for status in ("Suspended", "Active"):
        client.post(
            f"/api/v1/admin/users/{user['id']}/status",
            headers=admin_headers,
            json={"status": status},
        )

    entries = _audit(client, admin_headers, action="USER_REACTIVATED")
    assert any(e["entity_id"] == user["id"] for e in entries)


def test_a_role_change_is_recorded_as_a_role_change(client, admin_headers):
    user = _create(client, admin_headers, "um_audit_role")
    client.patch(
        f"/api/v1/admin/users/{user['id']}",
        headers=admin_headers,
        json={"role_id": _role_id(client, admin_headers, "Coordinator")},
    )

    entries = _audit(client, admin_headers, action="USER_ROLE_CHANGED")
    assert any(e["entity_id"] == user["id"] for e in entries)


def test_a_status_only_edit_is_not_recorded_twice(client, admin_headers):
    """One event, one entry. A second saying less would only take up space."""
    user = _create(client, admin_headers, "um_audit_once")
    client.patch(
        f"/api/v1/admin/users/{user['id']}",
        headers=admin_headers,
        json={"status": "Suspended"},
    )

    about = client.get(
        f"/api/v1/admin/users/{user['id']}/audit-logs", headers=admin_headers
    ).json()["items"]
    actions = [e["action"] for e in about]
    assert actions.count("USER_SUSPENDED") == 1
    assert "USER_UPDATED" not in actions


# ---------------------------------------------------------------------------
# The audit trail: portal activities, filtering, and immutability
# ---------------------------------------------------------------------------
def test_operational_actions_carry_an_action_too(client, admin_headers):
    """The log is not only about accounts.

    Every ``record_audit`` call site in the platform now names its verb, so a
    reviewer can ask "what was approved last week" across the whole portal
    rather than only across the user module.
    """
    _create(client, admin_headers, "um_portal")

    entries = _audit(client, admin_headers, limit=200)
    assert entries
    assert all(e["action"] for e in entries), "every entry must name its action"
    assert all(e["result"] in ("Success", "Failure") for e in entries)


def test_the_log_can_be_filtered_the_way_a_reviewer_asks_questions(
    client, admin_headers
):
    _create(client, admin_headers, "um_filter")
    assert _login(client, "um_filter", "wrong on purpose").status_code == 401

    failures = _audit(client, admin_headers, result="Failure", module="Auth")
    assert failures
    assert all(e["result"] == "Failure" for e in failures)
    assert all(e["module"] == "Auth" for e in failures)

    by_reason = _audit(client, admin_headers, search="incorrect password")
    assert by_reason
    assert all("ncorrect password" in (e["reason"] or "") for e in by_reason)


def test_a_users_history_covers_what_they_did_and_what_was_done_to_them(
    client, admin_headers
):
    """Both halves, or the screen hides the half a reviewer came for."""
    user = _create(client, admin_headers, "um_history")
    _headers(client, "um_history")  # something they did
    client.post(
        f"/api/v1/admin/users/{user['id']}/status",
        headers=admin_headers,
        json={"status": "Suspended"},
    )  # something done to them

    r = client.get(
        f"/api/v1/admin/users/{user['id']}/audit-logs", headers=admin_headers
    )
    assert r.status_code == 200, r.text
    actions = {e["action"] for e in r.json()["items"]}
    assert "LOGIN_SUCCESS" in actions, "what they did"
    assert "USER_SUSPENDED" in actions, "what was done to them"


def test_the_audit_log_offers_no_way_to_change_or_remove_an_entry(client):
    """Read-only is a property of the API surface, not of good intentions.

    A record the platform can revise on request is not evidence of anything, so
    the check is that no write verb exists at all -- for any role, including an
    administrator's.
    """
    from app.main import app

    audit_paths = [
        path for path in app.openapi()["paths"] if "audit-log" in path
    ]
    assert audit_paths, "the audit endpoints should exist to be checked"
    for path in audit_paths:
        methods = set(app.openapi()["paths"][path])
        assert methods == {"get"}, f"{path} exposes {methods - {'get'}}"


def test_a_non_admin_cannot_read_the_audit_log(client, admin_headers):
    _create(client, admin_headers, "um_nosy")
    headers = _headers(client, "um_nosy")

    assert client.get("/api/v1/admin/audit-logs", headers=headers).status_code == 403
    assert client.get("/api/v1/admin/users", headers=headers).status_code == 403


# ---------------------------------------------------------------------------
# Password reset requests
# ---------------------------------------------------------------------------
def test_a_reset_request_answers_the_same_whether_or_not_the_account_exists(
    client, admin_headers
):
    """Otherwise the endpoint is a way to enumerate who works here.

    It is reachable by anyone who can load the sign-in page, which is the whole
    point of it and also the reason it must not confirm anything.
    """
    _create(client, admin_headers, "um_forgot")

    real = client.post(
        "/api/v1/auth/password-reset-request", json={"identifier": "um_forgot"}
    )
    fake = client.post(
        "/api/v1/auth/password-reset-request", json={"identifier": "um_ghost"}
    )

    assert real.status_code == fake.status_code == 200
    assert real.json() == fake.json()


def test_a_reset_request_reaches_the_admin_queue_and_is_closed_by_the_reset(
    client, admin_headers
):
    user = _create(client, admin_headers, "um_queue")
    client.post(
        "/api/v1/auth/password-reset-request", json={"identifier": "um_queue"}
    )

    pending = client.get(
        "/api/v1/admin/password-reset-requests", headers=admin_headers
    ).json()
    mine = next(r for r in pending if r["user_id"] == user["id"])
    assert mine["username"] == "um_queue"
    assert mine["status"] == "Pending"

    client.post(
        f"/api/v1/admin/users/{user['id']}/reset-password",
        headers=admin_headers,
        json={},
    )

    still_pending = client.get(
        "/api/v1/admin/password-reset-requests", headers=admin_headers
    ).json()
    assert not [r for r in still_pending if r["user_id"] == user["id"]], (
        "actioning a request should close it, or the queue never empties"
    )


def test_a_request_naming_nobody_is_recorded_and_can_be_dismissed(
    client, admin_headers
):
    """A run of these is someone probing, which is worth an administrator seeing."""
    client.post(
        "/api/v1/auth/password-reset-request", json={"identifier": "um_stranger"}
    )

    pending = client.get(
        "/api/v1/admin/password-reset-requests", headers=admin_headers
    ).json()
    mine = next(r for r in pending if r["submitted_identifier"] == "um_stranger")
    assert mine["user_id"] is None

    dismissed = client.post(
        f"/api/v1/admin/password-reset-requests/{mine['id']}/dismiss",
        headers=admin_headers,
        json={"reason": "no such person"},
    )
    assert dismissed.status_code == 200

    # And not twice.
    again = client.post(
        f"/api/v1/admin/password-reset-requests/{mine['id']}/dismiss",
        headers=admin_headers,
        json={},
    )
    assert again.status_code == 400


def test_a_reset_request_grants_nothing_by_itself(client, admin_headers):
    """It is a message, not a credential."""
    _create(client, admin_headers, "um_no_grant")
    client.post(
        "/api/v1/auth/password-reset-request", json={"identifier": "um_no_grant"}
    )

    body = client.post(
        "/api/v1/auth/password-reset-request", json={"identifier": "um_no_grant"}
    ).json()
    assert "token" not in body
    assert "password" not in str(body).replace("password-reset", "").replace(
        "the password", ""
    )
    # The old password still works, because nothing was reset.
    assert _login(client, "um_no_grant").status_code == 200
