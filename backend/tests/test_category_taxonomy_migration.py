"""The five-category move renames rows; it must never re-create them.

``hc_remediations.problem_category_id`` points at these rows, and every
historical round in a site's timeline is read back through them. Deleting the
four old categories and inserting five fresh ones would orphan every open fix
and blank the category on every health check ever recorded -- which is why the
migration renames in place, and why that property is worth a test rather than a
comment: a delete-and-recreate would pass every other assertion in this file.
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_taxonomy_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON, text  # noqa: E402

_pg.JSONB = JSON

from datetime import datetime, timezone  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.core.bootstrap import DEFAULT_PROBLEM_CATEGORIES  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.deps import CATEGORY_OWNER_ROLES  # noqa: E402
from tests.conftest import create_schema  # noqa: E402

MIGRATION = "d8f4a13c6e07"
PREVIOUS = MIGRATION + "-1"

FINAL_NAMES = {
    "Managed Service",
    "CPG Project",
    "NWG RND",
    "Huawei Cleanup",
    "Temp Power",
}
OLD_NAMES = {
    "Temporary Power",
    "Project Responsibility",
    "MS Responsibility",
    "NWG Responsibility",
}


@pytest.fixture(scope="module", autouse=True)
def app_started():
    """Rebuild the schema, then start the app so bootstrap seeds the data."""
    if os.path.exists("/tmp/uep_taxonomy_pytest.db"):
        os.remove("/tmp/uep_taxonomy_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app):
        yield


def _alembic_config():
    from alembic.config import Config

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return Config(os.path.join(root, "alembic.ini"))


def _names():
    db = SessionLocal()
    try:
        return {
            r[0]
            for r in db.execute(text("SELECT name FROM problem_categories")).all()
        }
    finally:
        db.close()


# ---------------- the seeded state ----------------
def test_seeded_database_carries_the_five_final_categories():
    assert FINAL_NAMES <= _names()
    assert not (OLD_NAMES & _names()), "an old category name is still present"


def test_bootstrap_and_migration_agree_on_the_names():
    """Two places name these categories; they must not drift apart.

    ``bootstrap`` seeds a fresh database, the migration converts an existing
    one. If they disagree, which set an installation ends up with depends on
    how old it is -- the worst kind of difference to debug.
    """
    assert set(DEFAULT_PROBLEM_CATEGORIES) == FINAL_NAMES


def test_every_category_has_an_owning_role():
    """A category with no owner opens fixes that land in nobody's queue."""
    db = SessionLocal()
    try:
        orphans = db.execute(
            text("SELECT name FROM problem_categories WHERE owner_role_id IS NULL")
        ).all()
        assert not orphans, f"categories with no owning role: {orphans}"
    finally:
        db.close()


def test_huawei_cleanup_role_exists_and_owns_a_queue():
    db = SessionLocal()
    try:
        row = db.execute(
            text("SELECT is_category_owner FROM roles WHERE name = 'HuaweiCleanup'")
        ).first()
        assert row is not None, "the new owning role was never created"
        assert row[0], "the role must be flagged is_category_owner"
        assert "HuaweiCleanup" in CATEGORY_OWNER_ROLES
    finally:
        db.close()


# ---------------- the rename property ----------------
def _seed_site_with_open_fix(category_name):
    """A site, a failed round, and one open fix routed at *category_name*.

    Returns ``(work_item_id, category_id)``. Built through the ORM so the
    foreign keys and defaults come from the models rather than from hand-
    written SQL that has to be kept in step with them.
    """
    from app.models.health_check import HcAssignment, HcRemediation, HcTask
    from app.models.reference import Contractor, ProblemCategory
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        contractor = db.query(Contractor).first()
        if contractor is None:
            contractor = Contractor(name="Taxonomy Telecom", type="drive_test")
            db.add(contractor)
            db.flush()

        category = (
            db.query(ProblemCategory)
            .filter(ProblemCategory.name == category_name)
            .one()
        )

        site = Site(site_code=f"TAXO-{category.id:04d}")
        db.add(site)
        db.flush()
        wi = WorkItem(site_id=site.id, site_type="Greenfield")
        db.add(wi)
        db.flush()

        now = datetime.now(timezone.utc)
        assignment = HcAssignment(
            code=f"HC-TAXO-{category.id}", contractor_id=contractor.id,
            assigned_at=now, status="Open",
        )
        db.add(assignment)
        db.flush()
        task = HcTask(
            hc_assignment_id=assignment.id, work_item_id=wi.id, round_no=1,
            overall_result="NotReady", problem_category=category_name,
            completed_at=now,
        )
        db.add(task)
        db.flush()
        db.add(HcRemediation(
            hc_task_id=task.id, work_item_id=wi.id,
            problem_category_id=category.id,
            owner_role_id=category.owner_role_id,
            status=HcRemediation.STATUS_OPEN, opened_at=now,
        ))
        db.commit()
        return wi.id, category.id
    finally:
        db.close()


def test_rename_preserves_category_ids_and_their_remediations():
    """Downgrade, attach a fix to the old name, upgrade, check it survived."""
    from alembic import command

    command.downgrade(_alembic_config(), PREVIOUS)
    assert OLD_NAMES <= _names(), "downgrade did not restore the old names"

    wi_id, old_id = _seed_site_with_open_fix("Temporary Power")

    command.upgrade(_alembic_config(), "head")

    db = SessionLocal()
    try:
        new_id = db.execute(
            text("SELECT id FROM problem_categories WHERE name = 'Temp Power'")
        ).scalar()
        assert new_id == old_id, (
            "the category was re-created rather than renamed -- every open fix "
            "and every historical round pointing at the old id is orphaned"
        )

        rem = db.execute(
            text(
                "SELECT problem_category_id FROM hc_remediations "
                "WHERE work_item_id = :w"
            ),
            {"w": wi_id},
        ).scalar()
        assert rem == old_id, "the open fix lost its category"

        # The denormalised summary on the task is rewritten too, so a site does
        # not read one name in its history and another in the fix queue.
        summary = db.execute(
            text("SELECT problem_category FROM hc_tasks WHERE work_item_id = :w"),
            {"w": wi_id},
        ).scalar()
        assert summary == "Temp Power", summary
    finally:
        db.close()


def test_downgrade_keeps_a_huawei_cleanup_category_that_is_in_use():
    """A downgrade must not destroy work somebody did.

    With a fix routed to Huawei Cleanup, the downgrade deactivates the category
    rather than deleting it -- the row is what the history reads through.
    """
    from alembic import command

    _seed_site_with_open_fix("Huawei Cleanup")

    command.downgrade(_alembic_config(), PREVIOUS)
    db = SessionLocal()
    try:
        row = db.execute(
            text(
                "SELECT active FROM problem_categories WHERE name = 'Huawei Cleanup'"
            )
        ).first()
        assert row is not None, "a category with live fixes was deleted"
        assert not row[0], "it should be deactivated, not left active"
    finally:
        db.close()

    command.upgrade(_alembic_config(), "head")
    assert "Huawei Cleanup" in _names()
