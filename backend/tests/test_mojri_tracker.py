"""Mojri tracker reconciliation: the template, the reading of a cell, and who
may do either.

Three of these tests protect a rule that, if broken, would be believed:

* **nothing is written before Confirm.** A preview that quietly wrote would
  make the whole screen a lie, and the person would have approved numbers
  after the fact;
* **a cell for a technology the village never requested changes nothing.** A
  3G/4G village's 2G column is not a gap; counting it would report a shortfall
  that can never close;
* **a village that disappears from the file is never reverted.** Somebody
  filtering a row out of a spreadsheet is not evidence that a registration was
  withdrawn.

And one protects the rule the first release got wrong: **a row is matched on
(site_code, site_type, village_code), never on the internal id.** A CPM village
code that happens to equal some other village's primary key must not write
onto that village.

Run with:  cd backend && pytest tests/test_mojri_tracker.py -q
"""
import io
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_mojri_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402
from openpyxl import Workbook, load_workbook  # noqa: E402
from openpyxl.comments import Comment  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models.mojri import IN_TRACKER, NEEDS_LOOK, NOT_IN_TRACKER  # noqa: E402
from app.services import mojri_tracker  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form  # noqa: E402

DB_FILE = "/tmp/uep_mojri_pytest.db"

TEHRAN = "تهران"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

#: Set by _seed, read by the tests: label -> village id, and label -> the
#: (site_code, site_type, village_code) key a filled row carries for it.
IDS = {}
KEYS = {}


@pytest.fixture(scope="module")
def client():
    if os.path.exists(DB_FILE):
        os.remove(DB_FILE)
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed()
        yield c


def _seed() -> None:
    """The cases the importer has to tell apart.

    * ``three_tech``   2G/3G/4G, ICT approved -- the ordinary case
    * ``two_tech``     3G/4G only, ICT approved -- its 2G column must be ignored
    * ``cra_only``     CRA approved, ICT not -- still eligible for the template
    * ``no_tech``      approved, but CPM recorded no requested technology
    * ``not_eligible`` neither authority approved -- must not be in the template
    * ``twin_a/_b``    one village listed twice on one work item, as CPM does:
                       one key, two villages
    * ``decoy``        its village_code is three_tech's primary key -- a row
                       for it must never touch three_tech
    * ``deleted`` / ``deleted_wi``  the village / its work item soft-deleted
    """
    from datetime import datetime, timezone

    from app.models.reference import Province
    from app.models.workitem import Site, Village, WorkItem

    db = SessionLocal()
    try:
        province = db.query(Province).filter(Province.name == TEHRAN).one()

        def work_item(label, *, tech, site_type, deleted=False):
            site = Site(site_code=f"S-{label}", province_id=province.id)
            db.add(site)
            db.flush()
            item = WorkItem(
                site_id=site.id,
                site_type=site_type,
                requested_technology=tech,
                last_stage="راه_اندازی_دائم",
                dt_status="Done",
                current_stage="New",
                deleted_at=datetime.now(timezone.utc) if deleted else None,
            )
            db.add(item)
            db.flush()
            return site, item

        def village(label, item, site, code, *, ict, cra, deleted=False):
            row = Village(
                work_item_id=item.id,
                village_code=code,
                village_name=f"village {label}",
                target_classification="هدف",
                ict_status=ict,
                cra_status=cra,
                deleted_at=datetime.now(timezone.utc) if deleted else None,
            )
            db.add(row)
            db.flush()
            IDS[label] = row.id
            KEYS[label] = (site.site_code, item.site_type, code)

        def single(label, code, *, tech, ict, cra, site_type, deleted=False, deleted_wi=False):
            site, item = work_item(label, tech=tech, site_type=site_type, deleted=deleted_wi)
            village(label, item, site, code, ict=ict, cra=cra, deleted=deleted)

        single("three_tech", "100001", tech="2G3G4G", ict="Approved", cra="NotFiled", site_type="A")
        single("two_tech", "100002", tech="3G4G", ict="Approved", cra="NotFiled", site_type="B")
        single("cra_only", "100003", tech="2G", ict="NotFiled", cra="Approved", site_type="C")
        single("no_tech", "100004", tech=None, ict="Approved", cra="NotFiled", site_type="D")
        single("not_eligible", "100005", tech="2G", ict="NotFiled", cra="NotFiled", site_type="E")

        site, item = work_item("twin", tech="2G", site_type="F")
        village("twin_a", item, site, "229164", ict="Approved", cra="NotFiled")
        village("twin_b", item, site, "229164", ict="Approved", cra="NotFiled")

        single("decoy", str(IDS["three_tech"]), tech="2G", ict="Approved", cra="NotFiled", site_type="G")
        single("deleted", "100008", tech="2G", ict="Approved", cra="NotFiled", site_type="H",
               deleted=True)
        single("deleted_wi", "100009", tech="2G", ict="Approved", cra="NotFiled", site_type="I",
               deleted_wi=True)
        db.commit()
    finally:
        db.close()


# ----- Sign-in helpers ----------------------------------------------------


def _admin(client) -> dict:
    response = client.post("/api/v1/auth/login", data=login_form(client))
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture(scope="module")
def actors(client):
    admin_h = _admin(client)
    token = admin_h["Authorization"].split()[1]
    return {
        "admin": admin_h,
        "pm": login_as_role(client, token, "PM"),
        "coordinator": login_as_role(client, token, "Coordinator"),
    }


# ----- Building a filled template ----------------------------------------


#: Which part of a row's key each header carries. The legacy headers are the
#: ones the team's current file uses; their values are codes.
_KEY_HEADERS = {
    "site_code": 0, "site_id": 0,
    "site_type": 1,
    "village_code": 2, "village_id": 2,
}


def _fill(rows, *, headers=None, comments=None):
    """A filled template as .xlsx bytes.

    ``rows`` is a list of (key, {column: value}), where ``key`` is a label from
    KEYS or a (site_code, site_type, village_code) tuple written as given;
    ``comments`` is {(row_index, column): text} for the Excel-comment case.
    """
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "MojriTracker"
    header = list(headers or mojri_tracker.TEMPLATE_COLUMNS)
    sheet.append(header)
    for index, (key, cells) in enumerate(rows, start=2):
        key = KEYS[key] if isinstance(key, str) else key
        line = []
        for column in header:
            if column in _KEY_HEADERS:
                line.append(key[_KEY_HEADERS[column]])
            else:
                line.append(cells.get(column, ""))
        sheet.append(line)
        for (comment_row, column), text in (comments or {}).items():
            if comment_row == index and column in header:
                cell = sheet.cell(row=index, column=header.index(column) + 1)
                cell.comment = Comment(text, "tester")
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _upload(client, headers, path, content, **data):
    return client.post(
        f"/api/v1/mojri/{path}",
        headers=headers,
        files={"file": ("mojri.xlsx", content, XLSX)},
        data=data,
    )


def _preview(client, headers, content):
    response = _upload(client, headers, "import/preview", content)
    assert response.status_code == 200, response.text
    return response.json()


def _statuses(village_id):
    from app.models.mojri import MojriTrackerStatus

    db = SessionLocal()
    try:
        row = (
            db.query(MojriTrackerStatus)
            .filter(MojriTrackerStatus.village_id == village_id)
            .one_or_none()
        )
        return None if row is None else (row.ict_status, row.cra_status)
    finally:
        db.close()


# ----- The template -------------------------------------------------------


def _template_rows(client, actors) -> tuple[list, list[dict]]:
    response = client.get("/api/v1/mojri/template.xlsx", headers=actors["admin"])
    assert response.status_code == 200
    assert response.headers["content-type"] == XLSX
    sheet = load_workbook(io.BytesIO(response.content)).active
    header = [cell.value for cell in next(sheet.iter_rows(min_row=1, max_row=1))]
    rows = [
        dict(zip(header, row, strict=True))
        for row in sheet.iter_rows(min_row=2, values_only=True)
    ]
    return header, rows


def test_the_template_holds_the_villages_we_have_already_approved(client, actors):
    header, rows = _template_rows(client, actors)
    assert header == list(mojri_tracker.TEMPLATE_COLUMNS)

    keys = sorted((row["site_code"], row["site_type"], row["village_code"]) for row in rows)
    assert keys == sorted(
        KEYS[label]
        for label in ("three_tech", "two_tech", "cra_only", "no_tech", "twin_a", "twin_b", "decoy")
    )
    # A village neither authority has approved is not behind in anybody's
    # tracker yet, so it is not asked about; a deleted one is not a village.
    for label in ("not_eligible", "deleted", "deleted_wi"):
        assert KEYS[label] not in keys, label


def test_the_template_never_shows_the_internal_id(client, actors):
    """The id is what nobody filling the file can know. A column inviting them
    to type something into it is how the first release came to match CPM
    village codes against primary keys."""
    header, rows = _template_rows(client, actors)
    assert "village_id" not in header and "site_id" not in header
    assert header[:4] == ["site_code", "site_type", "village_code", "village_name"]
    two_tech = next(row for row in rows if row["site_code"] == "S-two_tech")
    assert two_tech["village_code"] == "100002"
    assert two_tech["village_name"] == "village two_tech"


def test_the_template_marks_technologies_a_village_never_requested(client, actors):
    _header, rows = _template_rows(client, actors)
    two_tech = next(row for row in rows if row["site_code"] == "S-two_tech")
    assert two_tech["ict_2g"] == "n/a"      # never requested
    # Blank, ready to fill. openpyxl reads an empty cell back as None.
    assert two_tech["ict_3g"] is None
    assert two_tech["ict_4g"] is None
    assert two_tech["site_type"] == "B"


def test_the_filename_carries_the_shamsi_period():
    name = mojri_tracker.template_filename((1404, 6))
    assert name == "mojri_template_1404_06.xlsx"


# ----- Reading a cell -----------------------------------------------------


@pytest.mark.parametrize(
    "value,expected",
    [
        ("yes", IN_TRACKER),
        ("Approved", IN_TRACKER),
        ("تایید", IN_TRACKER),
        ("✓", IN_TRACKER),
        (1, IN_TRACKER),
        ("", NOT_IN_TRACKER),
        ("   ", NOT_IN_TRACKER),
        ("?", NEEDS_LOOK),
        ("check", NEEDS_LOOK),
        ("yes - but see the letter", NEEDS_LOOK),
        ("registered 1404/05", NEEDS_LOOK),
        # A recognised rejection is NOT read as "not in the tracker": in a
        # registration column, refused and not-yet-done are different facts.
        ("no", NEEDS_LOOK),
        ("رد", NEEDS_LOOK),
    ],
)
def test_one_cell_routes_where_it_should(client, actors, value, expected):
    content = _fill(
        [("three_tech", {"ict_2g": value, "ict_3g": value, "ict_4g": value})]
    )
    payload = _preview(client, actors["pm"], content)
    counts = payload["authorities"]["ict"]
    assert counts[expected] == 1, payload


def test_a_cell_carrying_a_comment_needs_a_look(client, actors):
    """The value reads as a clean yes; the comment on it does not.

    A note somebody attached to a cell is the most common way a real file says
    "this one is complicated", and it is invisible to anything that reads only
    the value.
    """
    content = _fill(
        [("three_tech", {"ict_2g": "yes", "ict_3g": "yes", "ict_4g": "yes"})],
        comments={(2, "ict_3g"): "waiting on the letter"},
    )
    payload = _preview(client, actors["pm"], content)
    assert payload["authorities"]["ict"]["needs_look"] == 1
    assert payload["authorities"]["ict"]["in_tracker"] == 0


def test_one_unreadable_technology_makes_the_whole_village_need_a_look(client, actors):
    content = _fill(
        [("three_tech", {"ict_2g": "yes", "ict_3g": "yes", "ict_4g": "??"})]
    )
    payload = _preview(client, actors["pm"], content)
    # Not "two thirds registered". Never an average.
    assert payload["authorities"]["ict"]["needs_look"] == 1


def test_a_village_is_in_the_tracker_only_when_every_requested_tech_is(client, actors):
    content = _fill(
        [("three_tech", {"ict_2g": "yes", "ict_3g": "yes"})]  # 4G left blank
    )
    payload = _preview(client, actors["pm"], content)
    assert payload["authorities"]["ict"]["not_in_tracker"] == 1
    assert payload["authorities"]["ict"]["in_tracker"] == 0


def test_a_cell_for_a_technology_never_requested_changes_nothing(client, actors):
    """two_tech requested 3G and 4G. Its 2G column is not an answer.

    Filled with a yes it must not help; filled with nonsense it must not hurt.
    """
    for noise in ("yes", "???", "n/a"):
        content = _fill(
            [("two_tech", {"ict_2g": noise, "ict_3g": "yes", "ict_4g": "yes"})]
        )
        payload = _preview(client, actors["pm"], content)
        assert payload["authorities"]["ict"]["in_tracker"] == 1, noise
        assert payload["authorities"]["ict"]["needs_look"] == 0, noise


def test_the_two_authorities_are_independent(client, actors):
    content = _fill(
        [
            (
                "three_tech",
                {
                    "ict_2g": "yes", "ict_3g": "yes", "ict_4g": "yes",
                    "cra_2g": "yes", "cra_3g": "", "cra_4g": "",
                },
            )
        ]
    )
    payload = _preview(client, actors["pm"], content)
    assert payload["authorities"]["ict"]["in_tracker"] == 1
    assert payload["authorities"]["cra"]["not_in_tracker"] == 1


def test_a_village_with_no_requested_technology_needs_a_look(client, actors):
    """We do not know what to look for, so we do not claim either answer."""
    content = _fill([("no_tech", {"ict_2g": "yes"})])
    payload = _preview(client, actors["pm"], content)
    assert payload["authorities"]["ict"]["needs_look"] == 1


def test_the_technology_name_in_its_own_column_reads_in_tracker(client, actors):
    """The original CPM convention: the team marks a registered technology by
    writing its name in its own column. The CPM importer always read it that
    way; this one must read it the same (``acceptance_tokens.is_positive``)."""
    content = _fill([("three_tech", {"ict_2g": "2G", "ict_3g": "3G", "ict_4g": "4g"})])
    payload = _preview(client, actors["pm"], content)
    assert payload["authorities"]["ict"]["in_tracker"] == 1
    assert payload["authorities"]["ict"]["needs_look"] == 0


def test_another_technology_name_in_a_column_needs_a_look(client, actors):
    """"3G" in the 2G column is a note in the wrong place, not a yes."""
    content = _fill([("three_tech", {"ict_2g": "3G", "ict_3g": "3G", "ict_4g": "4G"})])
    payload = _preview(client, actors["pm"], content)
    assert payload["authorities"]["ict"]["needs_look"] == 1
    assert payload["authorities"]["ict"]["in_tracker"] == 0


# ----- Finding the village a row is about --------------------------------


def test_rows_match_on_site_code_site_type_and_village_code(client, actors):
    content = _fill(
        [
            ("three_tech", {"ict_2g": "yes", "ict_3g": "yes", "ict_4g": "yes"}),
            # Right village code, wrong site type: a different work item.
            (("S-three_tech", "B", "100001"), {"ict_2g": "yes"}),
            # Right site, wrong village code.
            (("S-three_tech", "A", "100002"), {"ict_2g": "yes"}),
        ]
    )
    payload = _preview(client, actors["pm"], content)
    assert payload["matched_rows"] == 1
    assert payload["villages_matched"] == 1
    assert payload["authorities"]["ict"]["in_tracker"] == 1
    assert [row["row"] for row in payload["exceptions"]] == [3, 4]


def test_a_village_code_equal_to_some_primary_key_does_not_match_that_village(
    client, actors
):
    """decoy's village_code is three_tech's primary key. The first release
    looked rows up by primary key and would have written this row onto
    three_tech; it must reach decoy and nothing else."""
    assert KEYS["decoy"][2] == str(IDS["three_tech"])
    content = _fill([("decoy", {"ict_2g": "yes"})])
    payload = _preview(client, actors["pm"], content)
    assert payload["villages_matched"] == 1 and payload["unmatched"] == 0

    response = _upload(client, actors["pm"], "import/commit", content, digest=payload["digest"])
    assert response.status_code == 200, response.text
    assert _statuses(IDS["decoy"]) == (IN_TRACKER, NOT_IN_TRACKER)
    assert _statuses(IDS["three_tech"]) is None


def test_legacy_headers_site_id_and_village_id_are_read_as_codes(client, actors):
    """The team's current file: the old headers, holding codes."""
    headers = ["site_id", "site_type", "village_id", *mojri_tracker.TECH_COLUMNS]
    content = _fill(
        [("three_tech", {"ict_2g": "2G", "ict_3g": "3G", "ict_4g": "4G"})],
        headers=headers,
    )
    payload = _preview(client, actors["pm"], content)
    assert payload["matched_rows"] == 1, payload["exceptions"]
    assert payload["authorities"]["ict"]["in_tracker"] == 1


@pytest.mark.parametrize(
    "key",
    [
        ("S-twin", "F", 229164),
        ("S-twin", "F", 229164.0),
        ("S-twin", "F", "229164.0"),
        (" s-twin ", " f ", " 229164 "),
    ],
)
def test_numeric_and_text_village_codes_match(client, actors, key):
    content = _fill([(key, {"ict_2g": "yes"})])
    payload = _preview(client, actors["pm"], content)
    assert payload["matched_rows"] == 1, payload["exceptions"]


def test_normalisation_is_one_function_for_the_file_and_the_database():
    assert mojri_tracker.match_key("CE0626", "Macro", 229164.0) == ("ce0626", "macro", "229164")
    assert mojri_tracker.match_key(" ce0626 ", "MACRO", "229164") == ("ce0626", "macro", "229164")
    assert mojri_tracker.match_key("A  B", "x", "1") == ("a b", "x", "1")
    assert mojri_tracker.match_key("CE0626", "", "1") is None
    # Excel drops a leading zero when it reads a code as a number.
    assert mojri_tracker.normalize_key_part("0229164") == "229164"
    # Only an integral number loses its decimals; a real decimal is kept.
    assert mojri_tracker.normalize_key_part("12.5") == "12.5"


def test_one_key_matching_two_villages_writes_both(client, actors):
    """CPM lists the same village twice on one work item, and UEP counts both
    rows. One row of the file answers for both."""
    content = _fill([("twin_a", {"ict_2g": "yes"})])
    payload = _preview(client, actors["pm"], content)
    assert payload["matched_rows"] == 1
    assert payload["villages_matched"] == 2
    assert payload["authorities"]["ict"]["in_tracker"] == 2

    response = _upload(client, actors["pm"], "import/commit", content, digest=payload["digest"])
    assert response.status_code == 200, response.text
    assert _statuses(IDS["twin_a"]) == (IN_TRACKER, NOT_IN_TRACKER)
    assert _statuses(IDS["twin_b"]) == (IN_TRACKER, NOT_IN_TRACKER)


def test_identical_repeated_rows_are_accepted_conflicting_ones_are_listed(client, actors):
    yes = {"ict_3g": "yes", "ict_4g": "yes"}
    content = _fill(
        [
            ("three_tech", {"ict_2g": "yes", "ict_3g": "yes", "ict_4g": "yes"}),
            ("three_tech", {"ict_2g": "2G", "ict_3g": "3G", "ict_4g": "4G"}),  # same answer
            ("two_tech", yes),
            ("two_tech", {"ict_3g": "yes", "ict_4g": ""}),                     # disagrees
        ]
    )
    payload = _preview(client, actors["pm"], content)
    assert payload["matched_rows"] == 2
    assert payload["villages_matched"] == 1
    assert payload["authorities"]["ict"]["in_tracker"] == 1
    assert [row["row"] for row in payload["exceptions"]] == [4, 5]
    assert {row["reason"] for row in payload["exceptions"]} == {
        "Repeated key with different answers (rows 4, 5)"
    }


def test_soft_deleted_villages_are_never_matched(client, actors):
    content = _fill([("deleted", {"ict_2g": "yes"}), ("deleted_wi", {"ict_2g": "yes"})])
    payload = _preview(client, actors["pm"], content)
    assert payload["matched_rows"] == 0
    assert {row["reason"] for row in payload["exceptions"]} == {mojri_tracker._NO_VILLAGE}


def test_confirm_is_refused_when_nothing_matches(client, actors):
    from app.models.mojri import MojriImportRun

    content = _fill([(("S-nowhere", "A", "424242"), {"ict_2g": "yes"})])
    payload = _preview(client, actors["pm"], content)
    assert payload["matched_rows"] == 0

    db = SessionLocal()
    runs_before = db.query(MojriImportRun).count()
    db.close()
    response = _upload(client, actors["pm"], "import/commit", content, digest=payload["digest"])
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "site_code" in detail and "village_code" in detail
    db = SessionLocal()
    assert db.query(MojriImportRun).count() == runs_before
    db.close()


# ----- Rows that cannot be read ------------------------------------------


def test_unmatched_and_repeated_rows_are_listed_not_dropped(client, actors):
    content = _fill(
        [
            ("two_tech", {"ict_3g": "yes", "ict_4g": "yes"}),
            (("S-nowhere", "A", "424242"), {"ict_2g": "yes"}),
            ("three_tech", {"ict_2g": "yes"}),
            ("three_tech", {"ict_2g": "no"}),
            (("S-three_tech", "A", None), {"ict_2g": "yes"}),
        ]
    )
    payload = _preview(client, actors["pm"], content)
    assert payload["total_rows"] == 5
    assert payload["matched_rows"] == payload["matched"] == 1
    assert payload["unmatched"] == 4
    reasons = {exception["reason"] for exception in payload["exceptions"]}
    assert mojri_tracker._NO_VILLAGE in reasons
    assert "village_code is blank" in reasons
    assert "Repeated key with different answers (rows 4, 5)" in reasons


def test_an_unmatched_row_is_named_by_its_codes_not_an_id(client, actors):
    content = _fill([(("S-nowhere", "A", "424242"), {"ict_2g": "yes"})])
    payload = _preview(client, actors["pm"], content)
    assert payload["exceptions"] == [
        {
            "row": 2,
            "site_code": "S-nowhere",
            "site_type": "A",
            "village_code": "424242",
            "reason": mojri_tracker._NO_VILLAGE,
        }
    ]


def test_a_file_without_village_code_is_refused(client, actors):
    content = _fill(
        [("three_tech", {})],
        headers=["site_code", "site_type", "ict_2g"],
    )
    response = _upload(client, actors["pm"], "import/preview", content)
    assert response.status_code == 400
    assert "village_code" in response.json()["detail"]


def test_something_that_is_not_a_workbook_is_refused(client, actors):
    response = _upload(client, actors["pm"], "import/preview", b"not a workbook")
    assert response.status_code == 400
    assert "template" in response.json()["detail"]


# ----- Nothing writes before Confirm -------------------------------------


def test_a_preview_writes_nothing_and_an_abandoned_upload_leaves_nothing(client, actors):
    from app.models.mojri import MojriImportRun, MojriTrackerStatus

    db = SessionLocal()
    before = (
        db.query(MojriTrackerStatus).count(),
        db.query(MojriImportRun).count(),
    )
    db.close()

    content = _fill(
        [("three_tech", {"ict_2g": "yes", "ict_3g": "yes", "ict_4g": "yes"})]
    )
    payload = _preview(client, actors["pm"], content)
    assert payload["authorities"]["ict"]["moving_to_in_tracker"] == 1

    db = SessionLocal()
    after = (
        db.query(MojriTrackerStatus).count(),
        db.query(MojriImportRun).count(),
    )
    db.close()
    assert after == before, "the preview wrote to the database"
    assert _statuses(IDS["three_tech"]) is None


def test_confirm_refuses_a_file_that_is_not_the_one_previewed(client, actors):
    previewed = _fill([("three_tech", {"ict_2g": "yes"})])
    payload = _preview(client, actors["pm"], previewed)

    swapped = _fill([("three_tech", {"ict_2g": "yes", "ict_3g": "yes"})])
    response = _upload(
        client, actors["pm"], "import/commit", swapped, digest=payload["digest"]
    )
    assert response.status_code == 400
    assert "previewed" in response.json()["detail"]
    assert _statuses(IDS["three_tech"]) is None


# ----- Confirm ------------------------------------------------------------


def test_confirm_writes_exactly_what_the_preview_showed(client, actors):
    content = _fill(
        [
            (
                "three_tech",
                {
                    "ict_2g": "yes", "ict_3g": "yes", "ict_4g": "yes",
                    "cra_2g": "?", "cra_3g": "", "cra_4g": "",
                },
            ),
            ("two_tech", {"ict_3g": "yes", "ict_4g": ""}),
        ]
    )
    payload = _preview(client, actors["pm"], content)
    response = _upload(
        client, actors["pm"], "import/commit", content, digest=payload["digest"]
    )
    assert response.status_code == 200, response.text
    committed = response.json()

    assert committed["authorities"] == payload["authorities"]
    assert committed["matched"] == payload["matched"]
    assert _statuses(IDS["three_tech"]) == (IN_TRACKER, NEEDS_LOOK)
    assert _statuses(IDS["two_tech"]) == (NOT_IN_TRACKER, NOT_IN_TRACKER)

    # The run is recorded, and every status points at it.
    from app.models.mojri import MojriImportRun, MojriTrackerStatus

    db = SessionLocal()
    run = db.get(MojriImportRun, committed["import_run_id"])
    assert run is not None and run.matched_rows == 2
    assert {
        row.source_import_id
        for row in db.query(MojriTrackerStatus).filter(
            MojriTrackerStatus.village_id.in_([IDS["three_tech"], IDS["two_tech"]])
        )
    } == {run.id}
    db.close()


def test_a_village_absent_from_this_file_is_flagged_and_never_reverted(client, actors):
    """three_tech is in the tracker from the import above. This file omits it."""
    assert _statuses(IDS["three_tech"])[0] == IN_TRACKER

    content = _fill([("two_tech", {"ict_3g": "yes", "ict_4g": "yes"})])
    payload = _preview(client, actors["pm"], content)
    missing = {item["village_id"]: item for item in payload["disappeared"]}
    assert IDS["three_tech"] in missing
    assert missing[IDS["three_tech"]]["authorities"] == ["ICT"]

    response = _upload(
        client, actors["pm"], "import/commit", content, digest=payload["digest"]
    )
    assert response.status_code == 200, response.text
    # Still in the tracker. A row missing from a spreadsheet is not a
    # withdrawal, and this import says nothing about it.
    assert _statuses(IDS["three_tech"])[0] == IN_TRACKER
    assert _statuses(IDS["two_tech"]) == (IN_TRACKER, NOT_IN_TRACKER)


def test_the_import_is_a_full_snapshot_of_the_villages_it_names(client, actors):
    """two_tech was in the tracker; this file says it is not any more."""
    assert _statuses(IDS["two_tech"])[0] == IN_TRACKER

    content = _fill([("two_tech", {"ict_3g": "", "ict_4g": ""})])
    payload = _preview(client, actors["pm"], content)
    response = _upload(
        client, actors["pm"], "import/commit", content, digest=payload["digest"]
    )
    assert response.status_code == 200, response.text
    assert _statuses(IDS["two_tech"])[0] == NOT_IN_TRACKER


def test_the_import_is_recorded_in_the_audit_log(client, actors):
    entries = client.get(
        "/api/v1/admin/audit-logs", headers=actors["admin"], params={"module": "mojri"}
    )
    assert entries.status_code == 200, entries.text
    rows = entries.json()
    rows = rows["items"] if isinstance(rows, dict) else rows
    assert any(row["action"] == "IMPORTED" for row in rows), rows


# ----- Who may do what ----------------------------------------------------


def test_admin_may_take_the_template_and_may_not_import(client, actors):
    """The Admin/PM separation, applied to this feature. Admin's button is a
    read; the write is PM's."""
    assert client.get(
        "/api/v1/mojri/template.xlsx", headers=actors["admin"]
    ).status_code == 200

    content = _fill([("three_tech", {"ict_2g": "yes"})])
    assert _upload(
        client, actors["admin"], "import/preview", content
    ).status_code == 403
    assert _upload(
        client, actors["admin"], "import/commit", content, digest="x"
    ).status_code == 403


def test_pm_reaches_both(client, actors):
    assert client.get(
        "/api/v1/mojri/template.xlsx", headers=actors["pm"]
    ).status_code == 200
    content = _fill([("three_tech", {"ict_2g": "yes"})])
    assert _upload(client, actors["pm"], "import/preview", content).status_code == 200


def test_coordinator_reaches_neither(client, actors):
    assert client.get(
        "/api/v1/mojri/template.xlsx", headers=actors["coordinator"]
    ).status_code == 403
    content = _fill([("three_tech", {"ict_2g": "yes"})])
    assert _upload(
        client, actors["coordinator"], "import/preview", content
    ).status_code == 403


# ----- What this feature must not touch -----------------------------------


def _acceptance_snapshot() -> dict:
    """Everything acceptance owns, row by row: the village roll-ups, the
    per-technology verdicts and the filed submissions."""
    from app.models.acceptance import Acceptance
    from app.models.acceptance_workflow import AcceptanceSubmission
    from app.models.workitem import Village

    db = SessionLocal()
    try:
        return {
            "villages": {
                village.id: (village.ict_status, village.cra_status)
                for village in db.query(Village).all()
            },
            "acceptances": {
                row.id: (row.village_id, row.technology, row.ict_status, row.cra_status,
                         row.ict_date, row.cra_date)
                for row in db.query(Acceptance).all()
            },
            "submissions": {
                row.id: (row.village_id, row.authority, row.round_no, row.review_status)
                for row in db.query(AcceptanceSubmission).all()
            },
        }
    finally:
        db.close()


def test_acceptance_is_untouched_by_an_import(client, actors):
    """This is a parallel record of somebody else's paperwork. It reads our
    acceptance data and never writes it: not the village roll-ups, not the
    per-technology verdicts, not a submission."""
    from datetime import datetime, timezone

    from app.models.acceptance import Acceptance
    from app.models.acceptance_workflow import AcceptanceSubmission

    db = SessionLocal()
    try:
        # Acceptance history for the village the file below marks, so there
        # is something for a stray write to change.
        db.add(Acceptance(
            village_id=IDS["cra_only"], technology="2G",
            ict_status="Pending", cra_status="Approved",
        ))
        db.add(AcceptanceSubmission(
            village_id=IDS["cra_only"], authority="ICT", round_no=1,
            letter_number="L-MOJRI-1", source="Contractor",
            review_status="Pending", submitted_at=datetime.now(timezone.utc),
        ))
        db.commit()
    finally:
        db.close()

    before = _acceptance_snapshot()
    assert before["acceptances"] and before["submissions"]

    content = _fill(
        [("cra_only", {"cra_2g": "yes", "ict_2g": "yes"})]
    )
    payload = _preview(client, actors["pm"], content)
    response = _upload(client, actors["pm"], "import/commit", content, digest=payload["digest"])
    assert response.status_code == 200, response.text

    assert _acceptance_snapshot() == before


def test_mojri_is_not_a_third_acceptance_authority():
    """The value set the acceptance workflow knows about is unchanged."""
    from app.models.acceptance_workflow import AUTHORITIES

    assert AUTHORITIES == ("ICT", "CRA")


# ----- The one-time cleanup ----------------------------------------------


def test_the_cleanup_migration_empties_statuses_and_keeps_the_runs(client):
    """e9a4c7b2d153: every status written before it was matched on the primary
    key and cannot be trusted, so all are deleted. The import runs are the
    audit history and stay."""
    from alembic import command
    from alembic.config import Config

    from app.models.mojri import MojriImportRun, MojriTrackerStatus
    from tests.conftest import BACKEND_DIR

    def counts():
        db = SessionLocal()
        try:
            return db.query(MojriTrackerStatus).count(), db.query(MojriImportRun).count()
        finally:
            db.close()

    statuses_before, runs_before = counts()
    assert statuses_before > 0 and runs_before > 0, "earlier tests should have imported"

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.downgrade(config, "c4f9a2e7d318")
    assert counts() == (statuses_before, runs_before), "the downgrade is a no-op"

    command.upgrade(config, "head")
    assert counts() == (0, runs_before)
