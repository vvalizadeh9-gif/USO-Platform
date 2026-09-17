"""Tests for the My Work workspace: buckets, the status cache, bulk letters.

Three things are being protected here, and only the first is new behaviour:

* The ``villages.ict_status`` / ``cra_status`` columns are a **cache**. Every
  test that moves a submission asserts the cached value equals what
  ``acceptance_workflow.authority_status`` derives, because a cache that can
  drift from the record is worse than no cache — the record has contractual
  consequences and the queue is what people act on.
* The four queue buckets **partition** the villages a user can see, so the
  counts sum to the total and no village is in two places at once.
* A bulk letter is all-or-nothing. One village whose requested technologies do
  not match the claim rolls the whole batch back, because a partly-filed batch
  leaves the submitter with no way to tell which villages went in.

Run with:  cd backend && pytest tests/test_my_work_endpoint.py -q
"""
import json
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_mywork_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

DB_PATH = "/tmp/uep_mywork_pytest.db"


@pytest.fixture(scope="module")
def client():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Helpers — deliberately the same shapes as test_acceptance_workflow.py
# ---------------------------------------------------------------------------
def _login(client, username="admin", password="Admin@12345") -> str:
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


_USERS: dict = {}


def _user_token(client, role_name: str, username: str, contractor_id=None) -> str:
    if username not in _USERS:
        headers = _auth(_login(client))
        roles = client.get("/api/v1/reference/roles", headers=headers).json()
        role_id = next(r["id"] for r in roles if r["name"] == role_name)
        created = client.post(
            "/api/v1/admin/users",
            headers=headers,
            json={
                "username": username,
                "password": "Test-Fixture-Passphrase",
                "first_name": "Test", "family_name": role_name,
                "role_id": role_id,
                "contractor_id": contractor_id,
                "sees_all_provinces": True,
                "province_ids": [],
            },
        )
        assert created.status_code == 201, created.text
        _USERS[username] = True
    return _login(client, username, "Test-Fixture-Passphrase")


def _seed(tag: str, *, technologies="2G", villages=1, dt_status="Done"):
    """A DT-Done site with *villages* villages. Returns (wi_id, [village_id], contractor_id)."""
    from app.models.reference import Contractor, Province
    from app.models.workitem import Site, Village, WorkItem

    db = SessionLocal()
    province = Province(name=f"Prov-{tag}")
    contractor = Contractor(name=f"Co-{tag}", type="drive_test")
    db.add_all([province, contractor])
    db.flush()

    site = Site(site_code=f"MW-{tag}", province_id=province.id)
    db.add(site)
    db.flush()

    work_item = WorkItem(
        site_id=site.id,
        site_type="Target",
        requested_technology=technologies,
        dt_status=dt_status,
        dt_sc_contractor_id=contractor.id,
        current_stage="DT Done",
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


def _approve_all(technologies):
    return [{"technology": t, "claimed_status": "Approved"} for t in technologies]


def _submit(client, token, village_id, authority, claims, letter="L-1"):
    return client.post(
        f"/api/v1/acceptance/villages/{village_id}/submissions",
        headers=_auth(token),
        json={
            "authority": authority,
            "letter_number": letter,
            "letter_date_shamsi": "1404/05/29",
            "technologies": claims,
        },
    )


def _review(client, token, submission_id, decision="Validated", comment=None):
    return client.post(
        f"/api/v1/acceptance/submissions/{submission_id}/review",
        headers=_auth(token),
        json={"decision": decision, "comment": comment},
    )


def _cache_matches_derived(village_id: int) -> tuple:
    """``(cached, derived)`` for both authorities, read straight from the DB."""
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.models.workitem import Village, WorkItem
    from app.services import acceptance_workflow as flow

    db = SessionLocal()
    try:
        village = db.execute(
            select(Village)
            .where(Village.id == village_id)
            .options(
                selectinload(Village.acceptances),
                selectinload(Village.work_item).selectinload(WorkItem.villages),
            )
        ).scalar_one()
        cached = (village.ict_status, village.cra_status)
        derived = (
            flow.authority_status(db, village, "ICT"),
            flow.authority_status(db, village, "CRA"),
        )
        return cached, derived
    finally:
        db.close()


def _assert_cache_is_honest(village_id: int, expected: tuple | None = None) -> None:
    cached, derived = _cache_matches_derived(village_id)
    assert cached == derived, f"cache {cached} drifted from derived {derived}"
    if expected is not None:
        assert cached == expected


# ---------------------------------------------------------------------------
# 1.2 — the cache tracks every state transition
# ---------------------------------------------------------------------------
def test_cache_follows_submit_return_resubmit_and_validate(client):
    """The cached status equals the derived one after every transition."""
    _wi, (village_id,), _co = _seed("CACHE")
    pm = _user_token(client, "PM", "mw_pm")
    coordinator = _user_token(client, "Coordinator", "mw_coord")

    # Nothing filed yet.
    _assert_cache_is_honest(village_id, ("NotFiled", "NotFiled"))

    # Submitted — awaiting review.
    first = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]))
    assert first.status_code == 201, first.text
    _assert_cache_is_honest(village_id, ("Pending", "NotFiled"))

    # Returned — back with the submitter.
    assert _review(
        client, coordinator, first.json()["id"],
        decision="Returned", comment="Illegible scan",
    ).status_code == 200
    _assert_cache_is_honest(village_id, ("Returned", "NotFiled"))

    # Round two, awaiting review again.
    second = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]), letter="L-2")
    assert second.status_code == 201, second.text
    _assert_cache_is_honest(village_id, ("Pending", "NotFiled"))

    # Validated — the verdict is now on the record.
    assert _review(client, coordinator, second.json()["id"]).status_code == 200
    _assert_cache_is_honest(village_id, ("Approved", "NotFiled"))


def test_cache_records_a_validated_rejection(client):
    """A rejected technology leaves the village Rejected for that authority."""
    _wi, (village_id,), _co = _seed("CACHEREJ", technologies="2G3G")
    pm = _user_token(client, "PM", "mw_pm")
    coordinator = _user_token(client, "Coordinator", "mw_coord")

    created = _submit(
        client, pm, village_id, "CRA",
        [
            {"technology": "2G", "claimed_status": "Approved"},
            {"technology": "3G", "claimed_status": "Rejected", "comment": "No coverage"},
        ],
    )
    assert created.status_code == 201, created.text
    assert _review(client, coordinator, created.json()["id"]).status_code == 200
    _assert_cache_is_honest(village_id, ("NotFiled", "Rejected"))


def test_cache_follows_a_withdrawal(client):
    """Withdrawing the only submission puts the village back to NotFiled."""
    _wi, (village_id,), _co = _seed("CACHEWD")
    pm = _user_token(client, "PM", "mw_pm")

    created = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]))
    assert created.status_code == 201, created.text
    _assert_cache_is_honest(village_id, ("Pending", "NotFiled"))

    withdrawn = client.post(
        f"/api/v1/acceptance/submissions/{created.json()['id']}/withdraw",
        headers=_auth(pm),
    )
    assert withdrawn.status_code == 200, withdrawn.text
    _assert_cache_is_honest(village_id, ("NotFiled", "NotFiled"))


def test_the_migration_backfill_reproduces_the_cache(client):
    """Wiping the cache and re-running the backfill restores the same values.

    The backfill in ``d1e5a8b3c9f2`` is the only code that has to derive these
    statuses without the ORM graph in front of it, so it is the most likely
    place for a second, subtly different interpretation of the rule to appear.
    This runs it against a database whose villages sit in all five states.
    """
    from sqlalchemy import text

    db = SessionLocal()
    try:
        before = {
            village_id: (ict, cra)
            for village_id, ict, cra in db.execute(
                text("SELECT id, ict_status, cra_status FROM villages")
            )
        }
        assert len({v for pair in before.values() for v in pair}) > 1, (
            "the fixtures should leave villages in more than one state"
        )
        db.execute(
            text("UPDATE villages SET ict_status = 'NotFiled', cra_status = 'NotFiled'")
        )
        db.commit()
    finally:
        db.close()

    import importlib.util
    from pathlib import Path

    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    # Loaded by path: alembic's versions/ directory is not an importable
    # package, and the point of this test is to run the real migration code
    # rather than a copy of it.
    revision_path = (
        Path(__file__).resolve().parent.parent
        / "alembic" / "versions" / "d1e5a8b3c9f2_village_authority_status.py"
    )
    spec = importlib.util.spec_from_file_location("_d1e5a8b3c9f2", revision_path)
    revision = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(revision)

    db = SessionLocal()
    try:
        context = MigrationContext.configure(db.connection())
        with Operations.context(Operations(context)):
            revision._backfill()
        db.commit()
        after = {
            village_id: (ict, cra)
            for village_id, ict, cra in db.execute(
                text("SELECT id, ict_status, cra_status FROM villages")
            )
        }
    finally:
        db.close()

    assert after == before


# ---------------------------------------------------------------------------
# 1.3 — buckets, counts, sorting and scope
# ---------------------------------------------------------------------------
def _bucket(client, token, name, **params):
    r = client.get(
        "/api/v1/acceptance/villages",
        headers=_auth(token),
        params={"bucket": name, "limit": 500, **params},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _counts(client, token, **params):
    r = client.get(
        "/api/v1/acceptance/villages/bucket-counts",
        headers=_auth(token),
        params=params,
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def buckets(client):
    """One site whose four villages sit in four different buckets."""
    pm = _user_token(client, "PM", "mw_pm")
    coordinator = _user_token(client, "Coordinator", "mw_coord")
    _wi, ids, contractor_id = _seed("BUCKETS", villages=4)
    closed, attention, awaiting, ready = ids

    # Closed: both authorities validated.
    for authority in ("ICT", "CRA"):
        created = _submit(client, pm, closed, authority, _approve_all(["2G"]))
        assert _review(client, coordinator, created.json()["id"]).status_code == 200

    # Needs attention: returned to the submitter.
    created = _submit(client, pm, attention, "ICT", _approve_all(["2G"]))
    assert _review(
        client, coordinator, created.json()["id"],
        decision="Returned", comment="Wrong letter number",
    ).status_code == 200

    # Awaiting review: submitted, nobody has looked at it.
    assert _submit(client, pm, awaiting, "CRA", _approve_all(["2G"])).status_code == 201

    # Ready: untouched.
    return {
        "pm": pm,
        "coordinator": coordinator,
        "contractor_id": contractor_id,
        "closed": closed,
        "needs_attention": attention,
        "awaiting_review": awaiting,
        "ready": ready,
        "site_id": _site_id_of(ready),
    }


def _site_id_of(village_id: int) -> int:
    from app.models.workitem import Village, WorkItem

    db = SessionLocal()
    try:
        village = db.get(Village, village_id)
        return db.get(WorkItem, village.work_item_id).site_id
    finally:
        db.close()


@pytest.mark.parametrize(
    "name", ["needs_attention", "ready", "awaiting_review", "closed"]
)
def test_a_bucket_returns_only_its_own_villages(client, buckets, name):
    """Each bucket contains the village seeded for it, and none of the others."""
    body = _bucket(client, buckets["pm"], name, site_id=buckets["site_id"])
    returned = {row["village_id"] for row in body["rows"]}
    assert returned == {buckets[name]}, f"{name} returned {returned}"
    # The row says which group it is in, and it agrees with the SQL that
    # selected it — the two implementations of the partition cannot drift.
    assert {row["bucket"] for row in body["rows"]} == {name}


def test_bucket_counts_sum_to_the_total(client, buckets):
    """The four buckets partition the list, so nothing is counted twice or lost."""
    counts = _counts(client, buckets["pm"], site_id=buckets["site_id"])
    assert counts["total"] == 4
    assert (
        counts["needs_attention"]
        + counts["ready"]
        + counts["awaiting_review"]
        + counts["closed"]
        == counts["total"]
    )
    assert counts["needs_attention"] == 1
    assert counts["ready"] == 1
    assert counts["awaiting_review"] == 1
    assert counts["closed"] == 1


def test_bucket_counts_match_the_lists_they_label(client, buckets):
    """A chip saying 12 opens a queue of 12 — checked across the whole scope."""
    counts = _counts(client, buckets["pm"])
    for name in ("needs_attention", "ready", "awaiting_review", "closed"):
        body = _bucket(client, buckets["pm"], name)
        assert body["total"] == counts[name], name


def test_an_unknown_bucket_or_sort_is_refused(client, buckets):
    for params in ({"bucket": "everything"}, {"sort": "alphabetical"}):
        r = client.get(
            "/api/v1/acceptance/villages",
            headers=_auth(buckets["pm"]),
            params=params,
        )
        assert r.status_code == 400, r.text


def test_needs_attention_is_oldest_first_by_default(client):
    """The village that has waited longest leads — it is the one costing time."""
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import text

    pm = _user_token(client, "PM", "mw_pm")
    coordinator = _user_token(client, "Coordinator", "mw_coord")
    _wi, (recent, old), _co = _seed("AGEING", villages=2)

    ids = {}
    for village_id in (recent, old):
        created = _submit(client, pm, village_id, "ICT", _approve_all(["2G"]))
        assert _review(
            client, coordinator, created.json()["id"],
            decision="Returned", comment="Illegible scan",
        ).status_code == 200
        ids[village_id] = created.json()["id"]

    # Age one of them by two months. Days are the unit the queue reports in,
    # so two submissions made in the same second are indistinguishable without
    # this.
    stale = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
    db = SessionLocal()
    try:
        db.execute(
            text("UPDATE acceptance_submissions SET reviewed_at = :when WHERE id = :id"),
            {"when": stale, "id": ids[old]},
        )
        db.commit()
    finally:
        db.close()

    def order(**params):
        body = _bucket(client, pm, "needs_attention", site_id=_site_id_of(old), **params)
        return [row["village_id"] for row in body["rows"]]

    assert order() == [old, recent]
    assert order(sort="newest_first") == [recent, old]
    assert order(sort="village_name") == sorted(
        [recent, old],
        key=lambda v: {recent: "Village AGEING-1", old: "Village AGEING-2"}[v],
    )


def test_the_list_pages_without_losing_the_total(client, buckets):
    """total counts the whole bucket; rows carry only the page asked for."""
    r = client.get(
        "/api/v1/acceptance/villages",
        headers=_auth(buckets["pm"]),
        params={"site_id": buckets["site_id"], "limit": 2, "offset": 0},
    )
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 4
    assert len(r.json()["rows"]) == 2


def test_a_contractor_sees_only_their_own_villages(client, buckets):
    """The scope rule the whole module rests on still holds for the new queries."""
    _wi, (theirs,), _other = _seed("OTHERCO")
    contractor = _user_token(
        client, "Contractor", "mw_contractor", contractor_id=buckets["contractor_id"]
    )

    body = _bucket(client, contractor, "ready")
    assert theirs not in {row["village_id"] for row in body["rows"]}
    assert buckets["ready"] in {row["village_id"] for row in body["rows"]}

    # And the counts are scoped the same way, not counted globally.
    counts = _counts(client, contractor)
    assert counts["total"] == len(
        _bucket(client, contractor, "closed")["rows"]
    ) + len(_bucket(client, contractor, "ready")["rows"]) + len(
        _bucket(client, contractor, "awaiting_review")["rows"]
    ) + len(_bucket(client, contractor, "needs_attention")["rows"])

    denied = client.get(
        f"/api/v1/acceptance/villages/{theirs}", headers=_auth(contractor)
    )
    assert denied.status_code == 404


# ---------------------------------------------------------------------------
# 1.4 — one letter, many villages
# ---------------------------------------------------------------------------
# The smallest byte string evidence_store accepts as a PDF. Type is checked by
# magic bytes, not by extension, so an empty file with a .pdf name is refused.
_SCAN = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"


def _bulk(client, token, village_ids, *, authority="ICT", letter="1404/8821",
          technologies=None, with_file=True):
    body = {
        "village_ids": village_ids,
        "authority": authority,
        "letter_number": letter,
        "letter_date_shamsi": "1404/05/29",
        "technologies": technologies or _approve_all(["2G"]),
    }
    files = {"payload": (None, json.dumps(body))}
    if with_file:
        files["file"] = ("letter.pdf", _SCAN, "application/pdf")
    return client.post(
        "/api/v1/acceptance/submissions/bulk", headers=_auth(token), files=files
    )


def test_bulk_creates_one_submission_per_village_on_one_file(client):
    """N villages, N submissions, one letter, and one blob on disk."""
    pm = _user_token(client, "PM", "mw_pm")
    _wi, ids, _co = _seed("BULK", villages=5)

    response = _bulk(client, pm, ids)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["count"] == 5
    assert body["letter_number"] == "1404/8821"
    assert {row["village_id"] for row in body["created"]} == set(ids)

    # Every submission carries the letter and the same scan.
    hashes = set()
    for row in body["created"]:
        detail = client.get(
            f"/api/v1/acceptance/villages/{row['village_id']}", headers=_auth(pm)
        ).json()
        submission = detail["submissions"][0]
        assert submission["letter_number"] == "1404/8821"
        assert len(submission["evidence"]) == 1
        hashes.add(submission["evidence"][0]["original_filename"])
    assert hashes == {"letter.pdf"}

    from sqlalchemy import text

    db = SessionLocal()
    try:
        stored = db.execute(
            text(
                "SELECT DISTINCT sha256 FROM acceptance_evidence e "
                "JOIN acceptance_submissions s ON s.id = e.submission_id "
                "WHERE s.letter_number = '1404/8821'"
            )
        ).scalars().all()
    finally:
        db.close()
    # Content-addressed: five rows, one file.
    assert len(stored) == 1

    # And every village is now awaiting review.
    for village_id in ids:
        _assert_cache_is_honest(village_id, ("Pending", "NotFiled"))


def test_bulk_rolls_back_entirely_when_one_village_does_not_match(client):
    """A village whose requested technologies differ fails the whole batch."""
    pm = _user_token(client, "PM", "mw_pm")
    _wi, (matching,), _co = _seed("BULKOK", technologies="2G")
    _wi2, (mismatched,), _co2 = _seed("BULKBAD", technologies="3G4G")

    response = _bulk(client, pm, [matching, mismatched])
    assert response.status_code == 400, response.text
    detail = response.json()["detail"]
    failed = {f["village_id"] for f in detail["failures"]}
    assert failed == {mismatched}
    assert "3G" in detail["failures"][0]["reason"]

    # Nothing was written — not even for the village that was fine.
    for village_id in (matching, mismatched):
        _assert_cache_is_honest(village_id, ("NotFiled", "NotFiled"))
        assert (
            client.get(
                f"/api/v1/acceptance/villages/{village_id}", headers=_auth(pm)
            ).json()["submissions"]
            == []
        )


def test_bulk_refuses_a_village_outside_the_callers_scope(client):
    """A contractor cannot reach another contractor's village through a batch."""
    _wi, (mine,), my_contractor = _seed("BULKMINE")
    _wi2, (theirs,), _other = _seed("BULKTHEIRS")
    contractor = _user_token(
        client, "Contractor", "mw_bulk_contractor", contractor_id=my_contractor
    )

    response = _bulk(client, contractor, [mine, theirs])
    assert response.status_code == 400, response.text
    failures = response.json()["detail"]["failures"]
    assert [f["village_id"] for f in failures] == [theirs]
    # The message says nothing about whose village it is.
    assert failures[0]["reason"] == "Village not found"
    _assert_cache_is_honest(mine, ("NotFiled", "NotFiled"))


def test_bulk_emits_one_notification_not_one_per_village(client):
    """A reviewer told a hundred times that a letter arrived learns nothing."""
    from sqlalchemy import text

    pm = _user_token(client, "PM", "mw_pm")
    _wi, ids, _co = _seed("BULKNOTIFY", villages=4)

    db = SessionLocal()
    try:
        before = db.execute(
            text("SELECT COUNT(*) FROM notifications WHERE type = 'AcceptanceBulkSubmitted'")
        ).scalar_one()
    finally:
        db.close()

    assert _bulk(client, pm, ids, letter="1404/9002").status_code == 201

    db = SessionLocal()
    try:
        rows = db.execute(
            text(
                "SELECT user_id, message FROM notifications "
                "WHERE type = 'AcceptanceBulkSubmitted'"
            )
        ).all()
    finally:
        db.close()
    fresh = [r for r in rows if "1404/9002" in r[1]]
    # One per reviewer, not one per village — and every one of them names the
    # letter and the count rather than a single village.
    assert len(fresh) == len({r[0] for r in fresh})
    assert len(rows) - before == len(fresh)
    assert "4 villages" in fresh[0][1]


def test_bulk_admin_is_refused(client):
    """Separation of duties: Admin does not file acceptance letters."""
    _wi, ids, _co = _seed("BULKADMIN", villages=2)
    response = _bulk(client, _login(client), ids)
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# ?awaiting=ICT|CRA — what the Action Center's counters link into.
#
# A counter that says "Awaiting CRA 12" and opens a queue of something else is
# a number the reader then has to re-derive by hand, which is worse than not
# having offered it.
# ---------------------------------------------------------------------------
def test_awaiting_narrows_the_queue_to_one_authority(client, buckets):
    """The village filed with CRA appears under CRA and not under ICT.

    Scoped to the fixture's own site: later tests in this module file their own
    letters, and this is a claim about the filter, not about the database.
    """
    token = buckets["pm"]
    site = buckets["site_id"]

    cra = _bucket(client, token, "awaiting_review", awaiting="CRA", site_id=site)
    assert [r["village_id"] for r in cra["rows"]] == [buckets["awaiting_review"]]

    # Nothing on this site is sitting with ICT — its only ICT submission was
    # returned, which is the contractor's move, not the authority's.
    ict = _bucket(client, token, "awaiting_review", awaiting="ICT", site_id=site)
    assert ict["rows"] == []


def test_awaiting_is_case_insensitive_and_validated(client, buckets):
    token = buckets["pm"]
    assert _bucket(
        client, token, "awaiting_review", awaiting="cra", site_id=buckets["site_id"]
    )["total"] == 1

    r = client.get(
        "/api/v1/acceptance/villages",
        headers=_auth(token),
        params={"awaiting": "MoC"},
    )
    assert r.status_code == 400


def test_awaiting_narrows_the_bucket_counts_too(client, buckets):
    """The chips have to agree with the list they label, filter and all."""
    counts = _counts(client, buckets["pm"], awaiting="CRA", site_id=buckets["site_id"])
    assert counts["awaiting_review"] == 1
    assert counts["total"] == 1
    assert counts["needs_attention"] == 0
    assert counts["ready"] == 0
    assert counts["closed"] == 0


# ---------------------------------------------------------------------------
# authority + status — what every figure on the Acceptance dashboard's
# authority cards links to. A number that opens a list of something else is
# worse than a number that does not open at all.
# ---------------------------------------------------------------------------
def test_authority_and_status_select_one_dashboard_figure(client, buckets):
    token, site = buckets["pm"], buckets["site_id"]

    # The CRA submission that nobody has reviewed.
    rows = _bucket(client, token, None, authority="CRA", status="Pending", site_id=site)
    assert [r["village_id"] for r in rows["rows"]] == [buckets["awaiting_review"]]

    # Both authorities validated on the closed village.
    for name in ("ICT", "CRA"):
        rows = _bucket(client, token, None, authority=name, status="Approved", site_id=site)
        assert [r["village_id"] for r in rows["rows"]] == [buckets["closed"]]

    # Returned to the submitter is its own status, not folded into Rejected.
    rows = _bucket(client, token, None, authority="ICT", status="Returned", site_id=site)
    assert [r["village_id"] for r in rows["rows"]] == [buckets["needs_attention"]]


def test_status_without_an_authority_is_refused(client, buckets):
    """"Pending with either authority" would double count, so it is not offered."""
    for params in ({"status": "Pending"}, {"authority": "ICT"}):
        r = client.get(
            "/api/v1/acceptance/villages", headers=_auth(buckets["pm"]), params=params
        )
        assert r.status_code == 400, params

    r = client.get(
        "/api/v1/acceptance/villages",
        headers=_auth(buckets["pm"]),
        params={"authority": "MoC", "status": "Pending"},
    )
    assert r.status_code == 400


def test_the_four_buckets_still_partition_after_the_rule_moved(client, buckets):
    """queue_bucket() now lives in acceptance_workflow; both callers agree.

    The SQL clause and the Python row body are separate implementations of one
    paragraph, and the dashboard counts the same four groups off the Python
    one. If they drift, a KPI and the list it links to disagree.
    """
    from app.models.workitem import Village
    from app.services import acceptance_workflow as flow

    db = SessionLocal()
    try:
        for name in flow.QUEUE_BUCKETS:
            listed = _bucket(client, buckets["pm"], name, site_id=buckets["site_id"])
            for row in listed["rows"]:
                village = db.get(Village, row["village_id"])
                assert row["bucket"] == name
                assert flow.queue_bucket(village.ict_status, village.cra_status) == name
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Verdict filters — what the Acceptance dashboard's figures link into
# ---------------------------------------------------------------------------
def _village_ids(client, token, **params):
    r = client.get(
        "/api/v1/acceptance/villages", headers=_auth(token), params=params
    )
    assert r.status_code == 200, r.text
    return {row["village_id"] for row in r.json()["rows"]}


def test_verdict_finds_a_refusal_the_status_filter_loses(client):
    """A rejected village that has been re-filed is still rejected.

    This is the whole reason ``ict_verdict`` exists. The queue status answers
    "whose move is it" and moves to Pending the moment a corrected round is
    sent; the verdict answers "where does this stand" and stays Rejected until
    someone validates it otherwise. The dashboard counts verdicts, so linking
    its Rejected figure at ``status=Rejected`` opened a list that had quietly
    dropped every village anyone had already acted on.
    """
    pm = _user_token(client, "PM", "mw_pm")
    coordinator = _user_token(client, "Coordinator", "mw_coord")
    _wi, (village_id,), _co = _seed("VERDICT", technologies="2G", villages=1)

    created = _submit(
        client, pm, village_id, "ICT",
        [{"technology": "2G", "claimed_status": "Rejected", "comment": "no mast"}],
    )
    assert _review(client, coordinator, created.json()["id"]).status_code == 200

    # Refused, and nobody has re-filed yet: both vocabularies agree.
    assert village_id in _village_ids(client, pm, ict_verdict="Rejected")
    assert village_id in _village_ids(client, pm, authority="ICT", status="Rejected")

    # Re-filed. The status moves; the verdict does not.
    assert _submit(
        client, pm, village_id, "ICT", _approve_all(["2G"]), letter="L-2"
    ).status_code == 201
    assert village_id in _village_ids(client, pm, ict_verdict="Rejected")
    assert village_id not in _village_ids(client, pm, authority="ICT", status="Rejected")


def test_verdicts_partition_the_list(client, buckets):
    """Approved, Rejected and Pending are exclusive and exhaustive.

    The three figures on an authority card sum to the villages it counts, so
    the three lists behind them must too — no village in two of them, none in
    none of them.
    """
    pm = buckets["pm"]
    scope = {"site_id": buckets["site_id"]}
    everything = _village_ids(client, pm, **scope)
    seen = []
    for verdict in ("Approved", "Rejected", "Pending"):
        seen.append(_village_ids(client, pm, ict_verdict=verdict, **scope))

    assert set().union(*seen) == everything
    assert sum(len(s) for s in seen) == len(everything)
    # NotApproved is the other two together — the half of a cross tab.
    assert _village_ids(client, pm, ict_verdict="NotApproved", **scope) == seen[1] | seen[2]


def test_both_verdicts_together_are_the_cross_tab(client, buckets):
    """ict_verdict=Approved&cra_verdict=NotApproved is "ICT ✓ / CRA ✗"."""
    pm = buckets["pm"]
    scope = {"site_id": buckets["site_id"]}
    rows = _village_ids(client, pm, ict_verdict="Approved", cra_verdict="NotApproved", **scope)
    assert rows == (
        _village_ids(client, pm, ict_verdict="Approved", **scope)
        & _village_ids(client, pm, cra_verdict="NotApproved", **scope)
    )
    # The village validated on both sides is in neither half of the cross tab.
    assert buckets["closed"] not in rows


def test_an_unknown_verdict_is_refused(client, buckets):
    r = client.get(
        "/api/v1/acceptance/villages",
        headers=_auth(buckets["pm"]),
        params={"ict_verdict": "Returned"},
    )
    assert r.status_code == 400
