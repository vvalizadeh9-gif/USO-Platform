"""Tests for the acceptance submission workflow.

The rules being protected here were set by the product owner, and several of
them look wrong until you know the domain:

* One rejected technology rejects the **whole village**, even when the other
  technologies were approved.
* A village is finished only when ICT **and** CRA have both approved it.
* A site with some villages approved and some not is "Partial".
* Only the technologies CPM requested may be answered — asking about a
  technology nobody requested is a data error, not a harmless extra field.
* Nothing a contractor submits reaches the ``acceptances`` table until a
  coordinator validates it.

Run with:  cd backend && pytest tests/test_acceptance_workflow.py -q
"""
import os
import sys
from datetime import date

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_acceptance_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

DB_PATH = "/tmp/uep_acceptance_pytest.db"


@pytest.fixture(scope="module")
def client():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username="admin", password="Admin@12345") -> str:
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


_USERS: dict = {}


def _user_token(client, role_name: str, username: str, contractor_id=None) -> str:
    """Create (once) and log in as a user holding *role_name*."""
    if username not in _USERS:
        headers = _auth(_login(client))
        roles = client.get("/api/v1/reference/roles", headers=headers).json()
        role_id = next(r["id"] for r in roles if r["name"] == role_name)
        created = client.post(
            "/api/v1/admin/users",
            headers=headers,
            json={
                "username": username,
                "password": "Passw0rd!",
                "full_name": f"Test {role_name}",
                "role_id": role_id,
                "contractor_id": contractor_id,
                "sees_all_provinces": True,
                "province_ids": [],
            },
        )
        assert created.status_code == 201, created.text
        _USERS[username] = True
    return _login(client, username, "Passw0rd!")


def _seed(tag: str, *, technologies="2G3G4G", villages=1, dt_status="Done"):
    """A DT-Done site with *villages* villages, assigned to a contractor.

    Returns ``(work_item_id, [village_id, ...], contractor_id)``.
    """
    from app.models.reference import Contractor, Province
    from app.models.workitem import Site, Village, WorkItem

    db = SessionLocal()
    province = Province(name=f"Prov-{tag}")
    contractor = Contractor(name=f"Co-{tag}", type="drive_test")
    db.add_all([province, contractor])
    db.flush()

    site = Site(site_code=f"ACC-{tag}", province_id=province.id)
    db.add(site)
    db.flush()

    work_item = WorkItem(
        site_id=site.id,
        site_type="Target",
        requested_technology=technologies,
        dt_status=dt_status,
        dt_sc_contractor_id=contractor.id,
        current_stage="Coordinator Approved",
    )
    db.add(work_item)
    db.flush()

    village_ids = []
    for n in range(villages):
        village = Village(
            work_item_id=work_item.id,
            village_code=f"{tag}-V{n + 1}",
            village_name=f"Village {tag}-{n + 1}",
            target_classification="هدف",
        )
        db.add(village)
        db.flush()
        village_ids.append(village.id)

    db.commit()
    result = (work_item.id, village_ids, contractor.id)
    db.close()
    return result


def _submit(client, token, village_id, authority, claims, letter="L-100", when="1404/05/29"):
    return client.post(
        f"/api/v1/acceptance/villages/{village_id}/submissions",
        headers=_auth(token),
        json={
            "authority": authority,
            "letter_number": letter,
            "letter_date_shamsi": when,
            "technologies": claims,
        },
    )


def _approve_all(technologies):
    return [{"technology": t, "claimed_status": "Approved"} for t in technologies]


def _validate(client, token, submission_id, decision="Validated", comment=None):
    return client.post(
        f"/api/v1/acceptance/submissions/{submission_id}/review",
        headers=_auth(token),
        json={"decision": decision, "comment": comment},
    )


def _village(client, token, village_id):
    r = client.get(
        f"/api/v1/acceptance/villages/{village_id}", headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# The happy path
# ---------------------------------------------------------------------------
def test_both_authorities_approved_closes_the_site(client):
    """ICT and CRA both approved on every requested technology closes the site."""
    _wi, (village_id,), _co = _seed("HAPPY", technologies="3G4G")
    pm = _user_token(client, "PM", "acc_pm")
    coordinator = _user_token(client, "Coordinator", "acc_coord")

    for authority in ("ICT", "CRA"):
        created = _submit(
            client, pm, village_id, authority, _approve_all(["3G", "4G"])
        )
        assert created.status_code == 201, created.text
        assert _validate(client, coordinator, created.json()["id"]).status_code == 200

    detail = _village(client, coordinator, village_id)
    assert detail["village"]["ict_verdict"] == "Approved"
    assert detail["village"]["cra_verdict"] == "Approved"
    assert detail["village"]["verdict"] == "Approved"
    assert detail["village"]["site_status"] == "Closed"


def test_ict_alone_does_not_finish_a_village(client):
    """ICT-approved and CRA-pending is not an approved village."""
    _wi, (village_id,), _co = _seed("ICTONLY", technologies="4G")
    pm = _user_token(client, "PM", "acc_pm")
    coordinator = _user_token(client, "Coordinator", "acc_coord")

    created = _submit(client, pm, village_id, "ICT", _approve_all(["4G"]))
    _validate(client, coordinator, created.json()["id"])

    detail = _village(client, coordinator, village_id)
    assert detail["village"]["ict_verdict"] == "Approved"
    assert detail["village"]["cra_verdict"] == "Pending"
    assert detail["village"]["verdict"] == "Pending"
    assert detail["village"]["site_status"] == "Open"


# ---------------------------------------------------------------------------
# The rules that look wrong and are not
# ---------------------------------------------------------------------------
def test_one_rejected_technology_rejects_the_whole_village(client):
    """3G approved, 4G rejected — the village is rejected, not partly approved."""
    _wi, (village_id,), _co = _seed("MIXED", technologies="3G4G")
    pm = _user_token(client, "PM", "acc_pm")
    coordinator = _user_token(client, "Coordinator", "acc_coord")

    created = _submit(
        client, pm, village_id, "ICT",
        [
            {"technology": "3G", "claimed_status": "Approved"},
            {"technology": "4G", "claimed_status": "Rejected", "comment": "No coverage"},
        ],
    )
    assert created.status_code == 201, created.text
    assert _validate(client, coordinator, created.json()["id"]).status_code == 200

    detail = _village(client, coordinator, village_id)
    assert detail["village"]["ict_verdict"] == "Rejected"
    assert detail["village"]["verdict"] == "Rejected"


def test_partly_approved_site_is_open_partial(client):
    """One village approved and one not makes the site Partial."""
    _wi, (first, second), _co = _seed("PARTIAL", technologies="2G", villages=2)
    pm = _user_token(client, "PM", "acc_pm")
    coordinator = _user_token(client, "Coordinator", "acc_coord")

    for authority in ("ICT", "CRA"):
        created = _submit(client, pm, first, authority, _approve_all(["2G"]))
        _validate(client, coordinator, created.json()["id"])

    detail = _village(client, coordinator, first)
    assert detail["village"]["verdict"] == "Approved"
    assert detail["village"]["site_status"] == "Partial"

    other = _village(client, coordinator, second)
    assert other["village"]["verdict"] == "Pending"
    assert other["village"]["site_status"] == "Partial"


def test_only_requested_technologies_may_be_answered(client):
    """A 3G/4G site cannot be given a 2G verdict, and cannot skip 4G."""
    _wi, (village_id,), _co = _seed("TECHGATE", technologies="3G4G")
    pm = _user_token(client, "PM", "acc_pm")

    unrequested = _submit(
        client, pm, village_id, "ICT",
        _approve_all(["2G", "3G", "4G"]),
    )
    assert unrequested.status_code == 400
    assert "2G" in unrequested.json()["detail"]

    incomplete = _submit(client, pm, village_id, "ICT", _approve_all(["3G"]))
    assert incomplete.status_code == 400
    assert "4G" in incomplete.json()["detail"]

    detail = _village(client, pm, village_id)
    assert detail["village"]["requested_technologies"] == ["3G", "4G"]


def test_rejection_requires_a_reason(client):
    """A rejected technology without a comment is refused."""
    _wi, (village_id,), _co = _seed("NOREASON", technologies="2G")
    pm = _user_token(client, "PM", "acc_pm")

    response = _submit(
        client, pm, village_id, "ICT",
        [{"technology": "2G", "claimed_status": "Rejected"}],
    )
    assert response.status_code == 400
    assert "comment is required" in response.json()["detail"].lower()


def test_acceptance_needs_a_finished_drive_test(client):
    """Acceptance approves completed drive-test work, so DT must be Done."""
    _wi, (village_id,), _co = _seed("NODT", technologies="2G", dt_status=None)
    pm = _user_token(client, "PM", "acc_pm")

    response = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]))
    assert response.status_code == 400
    assert "drive test" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Review, history and the contractor's basket
# ---------------------------------------------------------------------------
def test_nothing_reaches_the_record_before_validation(client):
    """A submitted claim leaves the village Pending until someone validates it."""
    _wi, (village_id,), _co = _seed("PENDING", technologies="2G")
    pm = _user_token(client, "PM", "acc_pm")

    created = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]))
    assert created.status_code == 201

    detail = _village(client, pm, village_id)
    assert detail["village"]["ict_verdict"] == "Pending"
    assert detail["village"]["pending_authorities"] == ["ICT"]
    # Already awaiting review: a second submission for the same authority is
    # refused rather than creating a duplicate for the coordinator to untangle.
    again = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]))
    assert again.status_code == 400


def test_returned_submission_keeps_its_history_and_allows_a_new_round(client):
    """A rejected round stays on the record; round 2 supersedes it."""
    _wi, (village_id,), _co = _seed("ROUNDS", technologies="2G")
    pm = _user_token(client, "PM", "acc_pm")
    coordinator = _user_token(client, "Coordinator", "acc_coord")

    first = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]), letter="L-1")
    returned = _validate(
        client, coordinator, first.json()["id"],
        decision="Returned", comment="Letter number does not match the scan",
    )
    assert returned.status_code == 200
    assert returned.json()["review_status"] == "Returned"

    second = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]), letter="L-2")
    assert second.status_code == 201, second.text
    assert second.json()["round_no"] == 2
    _validate(client, coordinator, second.json()["id"])

    detail = _village(client, coordinator, village_id)
    assert detail["village"]["ict_verdict"] == "Approved"
    # Both rounds survive: the first attempt and why it came back.
    history = detail["submissions"]
    assert len(history) == 2
    assert {h["round_no"] for h in history} == {1, 2}
    round_one = next(h for h in history if h["round_no"] == 1)
    assert round_one["review_status"] == "Returned"
    assert round_one["review_comment"] == "Letter number does not match the scan"


def test_returning_a_submission_requires_a_reason(client):
    """A return with no explanation tells the contractor nothing."""
    _wi, (village_id,), _co = _seed("NOWHY", technologies="2G")
    pm = _user_token(client, "PM", "acc_pm")
    coordinator = _user_token(client, "Coordinator", "acc_coord")

    created = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]))
    response = _validate(client, coordinator, created.json()["id"], decision="Returned")
    assert response.status_code == 400
    assert "reason is required" in response.json()["detail"].lower()


def test_a_submission_cannot_be_reviewed_twice(client):
    _wi, (village_id,), _co = _seed("TWICE", technologies="2G")
    pm = _user_token(client, "PM", "acc_pm")
    coordinator = _user_token(client, "Coordinator", "acc_coord")

    created = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]))
    assert _validate(client, coordinator, created.json()["id"]).status_code == 200
    assert _validate(client, coordinator, created.json()["id"]).status_code == 400


def test_letter_date_round_trips_through_shamsi(client):
    """1404/05/29 is stored Gregorian and shown back as Shamsi."""
    _wi, (village_id,), _co = _seed("DATE", technologies="2G")
    pm = _user_token(client, "PM", "acc_pm")

    created = _submit(
        client, pm, village_id, "ICT", _approve_all(["2G"]), when="1404/05/29"
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["letter_date"] == date(2025, 8, 20).isoformat()
    assert body["letter_date_shamsi"] == "1404/05/29"


def test_an_impossible_shamsi_date_is_refused(client):
    """31 Esfand does not exist in a common year and must not be shifted."""
    _wi, (village_id,), _co = _seed("BADDATE", technologies="2G")
    pm = _user_token(client, "PM", "acc_pm")

    response = _submit(
        client, pm, village_id, "ICT", _approve_all(["2G"]), when="1404/12/31"
    )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------
def test_a_contractor_sees_only_their_own_villages(client):
    """The village of another contractor's site is invisible, not merely denied."""
    _wi, (mine,), my_contractor = _seed("MINE", technologies="2G")
    _wi2, (theirs,), _other = _seed("THEIRS", technologies="2G")

    contractor = _user_token(
        client, "Contractor", "acc_contractor", contractor_id=my_contractor
    )

    assert client.get(
        f"/api/v1/acceptance/villages/{mine}", headers=_auth(contractor)
    ).status_code == 200
    assert client.get(
        f"/api/v1/acceptance/villages/{theirs}", headers=_auth(contractor)
    ).status_code == 404

    listing = client.get(
        "/api/v1/acceptance/villages", headers=_auth(contractor)
    ).json()
    assert {row["village_id"] for row in listing["rows"]} == {mine}


def test_a_contractor_cannot_validate_their_own_submission(client):
    """The separation that makes the record worth trusting."""
    _wi, (village_id,), contractor_id = _seed("SELFAPPROVE", technologies="2G")
    contractor = _user_token(
        client, "Contractor", "acc_contractor2", contractor_id=contractor_id
    )

    created = _submit(client, contractor, village_id, "ICT", _approve_all(["2G"]))
    assert created.status_code == 201, created.text
    assert created.json()["source"] == "Contractor"

    response = _validate(client, contractor, created.json()["id"])
    assert response.status_code == 403

    detail = _village(client, contractor, village_id)
    assert detail["village"]["ict_verdict"] == "Pending"


def test_admin_cannot_submit_or_validate(client):
    """Admin is a systems role; acceptance decisions are operational."""
    _wi, (village_id,), _co = _seed("ADMINBLOCK", technologies="2G")
    admin = _login(client)

    blocked = _submit(client, admin, village_id, "ICT", _approve_all(["2G"]))
    assert blocked.status_code == 403


# ---------------------------------------------------------------------------
# Evidence
# ---------------------------------------------------------------------------
def test_evidence_is_stored_once_however_many_villages_share_the_letter(client):
    """One letter covering many villages is one file on disk."""
    _wi, village_ids, _co = _seed("EVIDENCE", technologies="2G", villages=2)
    pm = _user_token(client, "PM", "acc_pm")
    scan = b"%PDF-1.7 the same scanned letter"

    hashes = set()
    for village_id in village_ids:
        created = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]))
        uploaded = client.post(
            f"/api/v1/acceptance/submissions/{created.json()['id']}/evidence",
            headers=_auth(pm),
            files={"file": ("letter.pdf", scan, "application/pdf")},
        )
        assert uploaded.status_code == 201, uploaded.text

        from app.models.acceptance_workflow import AcceptanceEvidence

        db = SessionLocal()
        record = db.get(AcceptanceEvidence, uploaded.json()["id"])
        hashes.add((record.sha256, record.stored_path))
        db.close()

    assert len(hashes) == 1, "the same bytes must resolve to the same stored file"


def test_a_disguised_file_is_refused(client):
    """The extension is a claim; the magic number is a fact."""
    _wi, (village_id,), _co = _seed("BADFILE", technologies="2G")
    pm = _user_token(client, "PM", "acc_pm")
    created = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]))

    response = client.post(
        f"/api/v1/acceptance/submissions/{created.json()['id']}/evidence",
        headers=_auth(pm),
        files={"file": ("letter.pdf", b"<html>not a pdf</html>", "application/pdf")},
    )
    assert response.status_code == 400
    assert "PDF" in response.json()["detail"]


def test_evidence_downloads_only_for_someone_who_may_see_the_village(client):
    _wi, (village_id,), _co = _seed("EVSCOPE", technologies="2G")
    _wi2, (_other,), other_contractor = _seed("EVSCOPE2", technologies="2G")
    pm = _user_token(client, "PM", "acc_pm")
    outsider = _user_token(
        client, "Contractor", "acc_outsider", contractor_id=other_contractor
    )

    created = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]))
    uploaded = client.post(
        f"/api/v1/acceptance/submissions/{created.json()['id']}/evidence",
        headers=_auth(pm),
        files={"file": ("letter.pdf", b"%PDF-1.7 scoped", "application/pdf")},
    )
    evidence_id = uploaded.json()["id"]

    assert client.get(
        f"/api/v1/acceptance/evidence/{evidence_id}/download", headers=_auth(pm)
    ).status_code == 200
    assert client.get(
        f"/api/v1/acceptance/evidence/{evidence_id}/download", headers=_auth(outsider)
    ).status_code == 404


# ---------------------------------------------------------------------------
# The guard on the CPM importer
# ---------------------------------------------------------------------------
def test_the_workbook_cannot_overwrite_a_decision_made_in_the_app(client):
    """A stale acceptance cell must not undo a coordinator's validation."""
    from app.models.acceptance import Acceptance
    from app.services.cpm_import import CpmImportService

    _wi, (village_id,), _co = _seed("CPMGUARD", technologies="2G")
    pm = _user_token(client, "PM", "acc_pm")
    coordinator = _user_token(client, "Coordinator", "acc_coord")

    created = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]))
    _validate(client, coordinator, created.json()["id"])

    db = SessionLocal()
    row = db.query(Acceptance).filter_by(village_id=village_id, technology="2G").one()
    assert row.ict_status == "Approved"
    assert row.ict_source == "App"

    # Simulate a later workbook still carrying a stale "rejected" for this
    # village, and confirm the guard holds.
    from app.models.workitem import Village
    from app.services import cpm_columns as C

    village = db.get(Village, village_id)
    raw = [None] * (max(C.COL_HISTORY.values()) + 1)
    raw[C.COL_HISTORY["ict_2g"]] = "رد"

    importer = CpmImportService.__new__(CpmImportService)
    importer._db = db
    importer._apply_acceptance(raw, village)
    db.flush()

    db.refresh(row)
    assert row.ict_status == "Approved", "the app is the system of record"
    db.rollback()
    db.close()


# ---------------------------------------------------------------------------
# Separation of duties, and the constraint underneath the pending check
# ---------------------------------------------------------------------------
def test_a_reviewer_cannot_validate_their_own_submission(client):
    """A claim becomes a fact only when someone else agrees.

    Coordinator and PM are in both the submit and review role lists, which is
    correct -- a coordinator who chased the approval themselves should be able
    to file it. Without an explicit check, though, one person could file a
    claim and validate it into the acceptances table in two API calls, which is
    exactly the separation this module's docstring promises is impossible.
    """
    _wi, (village_id,), _co = _seed("SELFREVIEW", technologies="2G")
    coordinator = _user_token(client, "Coordinator", "acc_coord")

    created = _submit(client, coordinator, village_id, "ICT", _approve_all(["2G"]))
    assert created.status_code == 201, created.text

    mine = _validate(client, coordinator, created.json()["id"])
    assert mine.status_code == 400, mine.text
    assert "your own submission" in mine.json()["detail"]

    # Nothing reached the acceptances table.
    detail = _village(client, coordinator, village_id)
    assert detail["village"]["ict_verdict"] == "Pending"


def test_someone_else_can_validate_that_same_submission(client):
    """The guard is about who, not about the submission being unreviewable."""
    _wi, (village_id,), _co = _seed("SELFREVIEW2", technologies="2G")
    coordinator = _user_token(client, "Coordinator", "acc_coord")
    pm = _user_token(client, "PM", "acc_pm")

    created = _submit(client, coordinator, village_id, "ICT", _approve_all(["2G"]))
    assert _validate(client, pm, created.json()["id"]).status_code == 200

    detail = _village(client, pm, village_id)
    assert detail["village"]["ict_verdict"] == "Approved"


def test_a_second_pending_submission_is_refused_by_the_database_too(client):
    """The application check is a read-then-write; the index is the guarantee.

    ``submit`` reads the table and raises if something is already pending, with
    nothing between the read and the insert -- so two simultaneous requests
    both passed it and the village ended up with two pending rows. From that
    moment ``_open_submission``'s ``scalar_one_or_none()`` raised
    MultipleResultsFound on every subsequent submit, review and queue refresh:
    a permanent 500 for that village, with no route to recovery through the
    interface.

    This drives the insert straight at the database, bypassing the application
    check the way a concurrent request effectively does.
    """
    import sqlalchemy

    from app.models.acceptance_workflow import AcceptanceSubmission
    from app.core.database import SessionLocal

    _wi, (village_id,), _co = _seed("RACE", technologies="2G")
    pm = _user_token(client, "PM", "acc_pm")

    created = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]))
    assert created.status_code == 201, created.text

    db = SessionLocal()
    try:
        db.add(
            AcceptanceSubmission(
                village_id=village_id,
                authority="ICT",
                round_no=99,
                letter_number="L-RACE",
                source="Coordinator",
                review_status="Pending",
                submitted_by=None,
            )
        )
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            db.flush()
    finally:
        db.rollback()
        db.close()


def test_the_index_still_allows_many_finished_rounds(client):
    """Only *pending* rows are constrained; a village bounces many times."""
    _wi, (village_id,), _co = _seed("MANYROUNDS", technologies="2G")
    pm = _user_token(client, "PM", "acc_pm")
    coordinator = _user_token(client, "Coordinator", "acc_coord")

    for round_number in range(3):
        created = _submit(
            client, pm, village_id, "ICT", _approve_all(["2G"]),
            letter=f"L-R{round_number}",
        )
        assert created.status_code == 201, created.text
        returned = client.post(
            f"/api/v1/acceptance/submissions/{created.json()['id']}/review",
            headers=_auth(coordinator),
            json={"decision": "Returned", "comment": "Please refile."},
        )
        assert returned.status_code == 200, returned.text

    detail = _village(client, pm, village_id)
    assert len(detail["submissions"]) == 3
