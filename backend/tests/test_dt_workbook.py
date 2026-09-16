"""The Drive Test delivery workbook.

The file is built for audits, management meetings and the regulator, which
makes one property the whole point:

    every number in it agrees with the dashboard at the moment it was
    generated.

So the tests here are parity tests. Each figure on the Summary sheet is read
back out of the workbook and compared with the endpoint it came from; the
Sites sheet is counted against ``/drive-test/sites``; the Open fixes sheet
against the queue service. Nothing is recomputed in the workbook, and these
are what keep it that way.

The other half is privacy, and it is tested by reading every cell of every
sheet rather than by reasoning about the code: a contractor's file must not
contain another company's name anywhere, including in a sheet nobody thought
about.

Run with:  cd backend && pytest tests/test_dt_workbook.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_dt_workbook_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

import io as _io  # noqa: E402
from datetime import date, datetime, timedelta, timezone  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from openpyxl import load_workbook  # noqa: E402

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.services import hc_queues  # noqa: E402
from app.services.workflow import (  # noqa: E402
    STAGE_ASSIGNED,
    STAGE_HEALTH_PROBLEM,
    STAGE_NEW,
    STAGE_READY,
)
from tests.conftest import create_schema, login_form  # noqa: E402

EXPORT = "/api/v1/drive-test/export"
OVERVIEW = "/api/v1/drive-test/overview"
SITES = "/api/v1/drive-test/sites"
PLAN = "/api/v1/drive-test/plan-delivery"

ONAIR = "راه_اندازی_دائم"
NOW = datetime.now(timezone.utc)
TODAY = date.today()

#: A Persian company name, because the privacy scan has to survive one.
BETA_NAME = "شرکت بتا"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_dt_workbook_pytest.db"):
        os.remove("/tmp/uep_dt_workbook_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username="admin", password="Admin@12345"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _role_id(client, headers, name):
    roles = client.get("/api/v1/reference/roles", headers=headers).json()
    return next(r["id"] for r in roles if r["name"] == name)


def _make_user(
    client, admin_h, username, role_name, *, contractor_id=None, province_ids=None
):
    password = "Test-Fixture-Passphrase"
    body = {
        "username": username,
        "password": password,
        "first_name": "Test",
        "family_name": username,
        "role_id": _role_id(client, admin_h, role_name),
        "sees_all_provinces": province_ids is None,
        "province_ids": province_ids or [],
    }
    if contractor_id is not None:
        body["contractor_id"] = contractor_id
    r = client.post("/api/v1/admin/users", headers=admin_h, json=body)
    assert r.status_code == 201, r.text
    return _login(client, username, password)


@pytest.fixture(scope="module")
def world(client):
    """Two provinces, two contractors, an open fix, and a month of delivery."""
    from app.models.health_check import HcAssignment, HcRemediation, HcTask
    from app.models.monthly_plan import STATUS_APPROVED, ContractorMonthlyPlan
    from app.models.reference import Contractor, ProblemCategory, Province, Role
    from app.models.workitem import Assignment, Site, Village, WorkItem

    admin_h = _login(client)
    db = SessionLocal()

    alfa = Contractor(name="Alfa Drive Tests", type="drive_test", active=True)
    beta = Contractor(name=BETA_NAME, type="drive_test", active=True)
    db.add_all([alfa, beta])
    kerman = Province(name="Kerman")
    yazd = Province(name="Yazd")
    db.add_all([kerman, yazd])
    db.flush()

    k_site = Site(site_code="WB-K", province_id=kerman.id)
    y_site = Site(site_code="WB-Y", province_id=yazd.id)
    db.add_all([k_site, y_site])
    db.flush()

    year, month = jalali.current_shamsi_period()
    this_month = jalali.from_shamsi_date(year, month, 1)

    def item(site, tag, stage, *, dt_status=None, category=None, contractor=None,
             dt_date=None, assign_days=None):
        wi = WorkItem(
            site_id=site.id,
            site_type=tag,
            last_stage=ONAIR,
            current_stage=stage,
            dt_status=dt_status,
            dt_problem_category=category,
            dt_sc_contractor_id=contractor,
            launch_date_gregorian=TODAY - timedelta(days=120),
            dt_date_gregorian=dt_date,
        )
        db.add(wi)
        db.flush()
        db.add(Village(work_item_id=wi.id, village_name=f"روستای {tag}"))
        if assign_days is not None and contractor is not None:
            db.add(
                Assignment(
                    work_item_id=wi.id,
                    assignment_type="official",
                    contractor_id=contractor,
                    assigned_at=NOW - timedelta(days=assign_days),
                    is_active=True,
                )
            )
        return wi

    item(k_site, "ong-new", STAGE_NEW)
    item(k_site, "ong-assigned", STAGE_ASSIGNED, contractor=alfa.id, assign_days=20)
    item(y_site, "ong-beta", STAGE_ASSIGNED, contractor=beta.id, assign_days=5)
    item(k_site, "done-1", STAGE_NEW, dt_status="Done", dt_date=this_month,
         contractor=alfa.id, assign_days=60)
    item(y_site, "done-2", STAGE_NEW, dt_status="Done", dt_date=this_month,
         contractor=beta.id, assign_days=50)
    cpm_flagged = item(
        k_site, "prob-cpm", STAGE_READY, dt_status="Problematic", category="Temp Power"
    )
    flagged = item(y_site, "prob-inapp", STAGE_HEALTH_PROBLEM, contractor=beta.id)

    # Two open fixes, owned by different roles and late by different amounts.
    # Two rather than one deliberately: with a single row a sheet that dropped
    # or truncated rows would still count right, and the worst-late-first
    # ordering would have nothing to order.
    categories = db.query(ProblemCategory).filter(
        ProblemCategory.owner_role_id.is_not(None)
    ).order_by(ProblemCategory.id).all()
    power, other = categories[0], categories[1]
    hca = HcAssignment(
        code="HCA-WB-1", contractor_id=beta.id,
        assigned_at=NOW - timedelta(days=40), status="Open",
    )
    db.add(hca)
    db.flush()
    task = HcTask(
        hc_assignment_id=hca.id, work_item_id=flagged.id, round_no=2,
        overall_result="NotReady", problem_category=power.name,
        completed_at=NOW - timedelta(days=30), reviewed_at=NOW - timedelta(days=29),
    )
    db.add(task)
    db.flush()
    db.add(
        HcRemediation(
            hc_task_id=task.id, work_item_id=flagged.id,
            problem_category_id=power.id, owner_role_id=power.owner_role_id,
            status=HcRemediation.STATUS_OPEN,
            opened_at=NOW - timedelta(days=29), due_at=NOW - timedelta(days=7),
        )
    )

    # The second fix: another site, another owning role, less overdue.
    hcb = HcAssignment(
        code="HCA-WB-2", contractor_id=alfa.id,
        assigned_at=NOW - timedelta(days=20), status="Open",
    )
    db.add(hcb)
    db.flush()
    task_b = HcTask(
        hc_assignment_id=hcb.id, work_item_id=cpm_flagged.id, round_no=1,
        overall_result="NotReady", problem_category=other.name,
        completed_at=NOW - timedelta(days=12), reviewed_at=NOW - timedelta(days=11),
    )
    db.add(task_b)
    db.flush()
    db.add(
        HcRemediation(
            hc_task_id=task_b.id, work_item_id=cpm_flagged.id,
            problem_category_id=other.id, owner_role_id=other.owner_role_id,
            status=HcRemediation.STATUS_OPEN,
            opened_at=NOW - timedelta(days=11), due_at=NOW - timedelta(days=2),
        )
    )

    # An approved plan, so the Summary's PIP and achievement are not both zero.
    for contractor_id, committed in ((alfa.id, 3), (beta.id, 2)):
        db.add(
            ContractorMonthlyPlan(
                contractor_id=contractor_id,
                shamsi_year=year,
                shamsi_month=month,
                version=1,
                committed_count=committed,
                status=STATUS_APPROVED,
                is_current=True,
                submitted_at=NOW - timedelta(days=10),
            )
        )

    db.commit()
    owner_role = db.get(Role, power.owner_role_id).name
    ids = {
        "alfa": alfa.id, "beta": beta.id,
        "kerman": kerman.id, "yazd": yazd.id,
        "flagged": flagged.id, "owner_role": owner_role,
    }
    db.close()

    return {
        "admin": admin_h,
        "ids": ids,
        "alfa": _make_user(client, admin_h, "wb_alfa", "Contractor", contractor_id=ids["alfa"]),
        "beta": _make_user(client, admin_h, "wb_beta", "Contractor", contractor_id=ids["beta"]),
        "owner": _make_user(client, admin_h, "wb_owner", owner_role),
        "kerman_staff": _make_user(
            client, admin_h, "wb_kerman", "Coordinator", province_ids=[ids["kerman"]]
        ),
    }


# ------------------------------------------------------------------ helpers
def _workbook(client, headers, **params):
    r = client.get(EXPORT, headers=headers, params=params)
    assert r.status_code == 200, r.text
    return load_workbook(_io.BytesIO(r.content))


def _summary(ws) -> dict:
    """The Summary sheet's label/value pairs, as a dict.

    Read back out of the file rather than compared against what the code
    meant to write: the point is that the file a person opens holds the right
    figure, not that a function was called.
    """
    out = {}
    for row in ws.iter_rows(min_row=1, max_col=2, values_only=True):
        label, value = row[0], row[1]
        if isinstance(label, str) and value is not None:
            out[label] = value
    return out


def _all_cells(wb) -> list[str]:
    return [
        str(cell)
        for sheet in wb.worksheets
        for row in sheet.iter_rows(values_only=True)
        for cell in row
        if cell is not None
    ]


def _rows(ws) -> list[tuple]:
    return [r for r in ws.iter_rows(min_row=2, values_only=True) if any(v not in (None, "") for v in r)]


# ------------------------------------------------------------- 1. the parity
def test_the_summary_agrees_with_the_dashboard(client, world):
    headers = world["admin"]
    body = client.get(OVERVIEW, headers=headers).json()
    plan = client.get(PLAN, headers=headers).json()
    kpis = body["kpis"]

    summary = _summary(_workbook(client, headers)["Summary"])

    assert summary["On-air"] == kpis["total_onair"]["value"]
    assert summary["Drive tests done"] == kpis["total_dt_done"]["value"]
    assert summary["Ongoing"] == kpis["total_ongoing"]["value"]
    assert summary["Problematic"] == kpis["total_problematic"]["value"]
    assert summary["Remaining"] == kpis["total_remaining"]["value"]

    assert summary["Assigned"] == plan["assigned"]
    assert summary["PIP"] == plan["pip"]
    assert summary["Delivered"] == plan["actual"]
    assert summary["Achievement %"] == (plan["achievement_percent"] or "—")

    # The breakdowns, bucket by bucket rather than in total: a sum can agree
    # while the rows behind it are wrong.
    for point in body["problematic_breakdown"]["by_category"]:
        assert summary[point["name"]] == point["value"]
    ongoing = body["ongoing_breakdown"]
    for point in ongoing["by_age"] + ongoing["by_stage"]:
        assert summary[point["name"]] == point["value"]
    assert summary["No assignment date"] == ongoing["without_assignment_date"]

    assert summary["Generated by"] == "Admin"


def test_the_summary_says_the_trend_is_not_in_the_file(client, world):
    """The omission is stated, not left to be noticed."""
    cells = _all_cells(_workbook(client, world["admin"]))
    assert any("Trend and month-on-month movement are not in this file" in c for c in cells)


def test_the_sites_sheet_is_the_on_air_list(client, world):
    headers = world["admin"]
    listed = client.get(SITES, headers=headers, params={"bucket": "onair", "limit": 500}).json()
    body = client.get(OVERVIEW, headers=headers).json()
    kpis = body["kpis"]

    wb = _workbook(client, headers)
    rows = _rows(wb["Sites"])
    assert len(rows) == listed["total"]

    # The buckets inside the sheet reconcile to the cards on the dashboard.
    bucket_col = [c.value for c in wb["Sites"][1]].index("Bucket")
    buckets = [r[bucket_col] for r in rows]
    assert buckets.count("Done") == kpis["total_dt_done"]["value"]
    assert buckets.count("Ongoing") == kpis["total_ongoing"]["value"]
    assert buckets.count("Problematic") == kpis["total_problematic"]["value"]


def test_the_open_fixes_sheet_matches_the_queue_service(client, world):
    headers = world["admin"]
    db = SessionLocal()
    try:
        from app.models.reference import User

        admin = db.query(User).filter(User.username == "admin").one()
        expected = hc_queues.remediations(db, admin)
    finally:
        db.close()

    rows = _rows(_workbook(client, headers)["Open fixes"])
    assert len(rows) == len(expected) > 1

    # Worst-late first, the queue's own order rather than a second sort.
    late_col = [c.value for c in _workbook(client, headers)["Open fixes"][1]].index("Days late")
    assert [r[late_col] for r in rows] == sorted(
        [r[late_col] for r in rows], reverse=True
    )


# ------------------------------------------------------------ 2. the privacy
def test_a_contractors_file_never_names_another_company(client, world):
    """Every cell of every sheet, not just the ones that obviously hold names."""
    wb = _workbook(client, world["alfa"])
    cells = _all_cells(wb)

    assert cells, "an empty file would pass this test without proving anything"
    for cell in cells:
        assert BETA_NAME not in cell, f"another contractor's name appears in {cell!r}"

    # Their own name is present, so the scan is looking at rows that exist.
    assert any("Alfa Drive Tests" in c for c in cells)
    assert any("your own company's work only" in c for c in cells)


def test_a_contractors_ledger_holds_only_their_own_row(client, world):
    wb = _workbook(client, world["beta"])
    name_col = [c.value for c in wb["Contractor ledger"][1]].index("Subcontractor")
    names = {r[name_col] for r in _rows(wb["Contractor ledger"])}

    assert names <= {BETA_NAME}
    assert "Alfa Drive Tests" not in names


def test_a_category_owner_gets_no_ledger_and_only_their_own_fixes(client, world):
    wb = _workbook(client, world["owner"])

    assert "Contractor ledger" not in wb.sheetnames
    assert wb.sheetnames == ["Summary", "Sites", "Open fixes", "Provinces"]

    # One of the two open fixes is routed to this role; the other is not
    # theirs to see, and the scope is what keeps it out.
    fixes = _rows(wb["Open fixes"])
    assert len(fixes) == 1
    owner_col = [c.value for c in wb["Open fixes"][1]].index("Owner role")
    assert {r[owner_col] for r in fixes} == {world["ids"]["owner_role"]}


# ------------------------------------------------------- 3. scope and shape
def test_the_province_filter_narrows_the_whole_file(client, world):
    headers = world["admin"]
    whole = _workbook(client, headers)
    kerman = _workbook(client, headers, province_id=world["ids"]["kerman"])

    assert len(_rows(kerman["Sites"])) < len(_rows(whole["Sites"]))
    province_col = [c.value for c in kerman["Sites"][1]].index("Province")
    assert {r[province_col] for r in _rows(kerman["Sites"])} <= {"Kerman"}
    assert _summary(kerman["Summary"])["Scope"] == "Kerman"


def test_a_province_outside_the_scope_gives_an_empty_but_valid_file(client, world):
    """No error, and nothing that says whether that province exists."""
    wb = _workbook(client, world["kerman_staff"], province_id=world["ids"]["yazd"])

    assert wb.sheetnames[:3] == ["Summary", "Sites", "Open fixes"]
    assert _rows(wb["Sites"]) == []
    assert _rows(wb["Open fixes"]) == []
    assert _summary(wb["Summary"])["On-air"] == 0
    assert "Yazd" not in " ".join(_all_cells(wb))


def test_an_empty_scope_still_produces_every_sheet_and_header(client, world):
    """A file with no rows is still a file somebody can open and read."""
    empty = _make_user(
        client, world["admin"], "wb_nowhere", "Coordinator", province_ids=[]
    )
    wb = _workbook(client, empty)

    assert wb.sheetnames == [
        "Summary", "Sites", "Open fixes", "Contractor ledger", "Provinces"
    ]
    for sheet, first_header in (
        ("Sites", "Site ID"),
        ("Open fixes", "Site ID"),
        ("Provinces", "Province"),
    ):
        assert wb[sheet].cell(row=1, column=1).value == first_header
        assert _rows(wb[sheet]) == []
    assert _summary(wb["Summary"])["On-air"] == 0


def test_numbers_are_stored_as_numbers(client, world):
    """A figure stored as text cannot be summed, sorted or charted.

    Which is most of what somebody opens a spreadsheet to do.
    """
    wb = _workbook(client, world["admin"])
    summary = wb["Summary"]

    values = {}
    for row in summary.iter_rows(min_row=1, max_col=2):
        if isinstance(row[0].value, str) and row[1].value is not None:
            values[row[0].value] = row[1]
    for label in ("On-air", "Drive tests done", "Ongoing", "Problematic", "Remaining"):
        assert isinstance(values[label].value, int), label

    sites = wb["Sites"]
    headers = [c.value for c in sites[1]]
    days = headers.index("Days since launch") + 1
    for r in range(2, sites.max_row + 1):
        value = sites.cell(row=r, column=days).value
        assert value == "" or isinstance(value, int), value


def test_the_filename_names_the_scope_and_the_day(client, world):
    r = client.get(EXPORT, headers=world["admin"], params={"province_id": world["ids"]["kerman"]})
    disposition = r.headers["content-disposition"]

    assert "dt-delivery-kerman-" in disposition
    assert disposition.endswith('.xlsx"')
    assert disposition.isascii()
