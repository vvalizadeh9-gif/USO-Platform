"""repair a legacy database so it matches the models

Revision ID: b7f1c2d9e4a3
Revises: 97e73674816a
Create Date: 2026-08-14

WHAT THIS IS FOR
================

Until now the application managed its own schema at startup, in three different
ways at once: ``Base.metadata.create_all()``, a hand-written ``ADDITIVE_COLUMNS``
table of raw ``ALTER TABLE`` statements, and ``ADDITIVE_INDEXES``. The raw
``ALTER TABLE`` statements did not say quite the same thing as the models, so a
database that grew through them ended up subtly different from one created fresh.

Five columns drifted:

===============================  ===================  =====================
Column                           Models say           Legacy database has
===============================  ===================  =====================
hc_tasks.reviewed_at             timestamptz          timestamp (no zone)
assignments.returned_at          timestamptz          timestamp (no zone)
hc_tasks.reviewed_by             FK -> users.id       plain integer
work_items.dt_sc_contractor_id   FK -> contractors.id plain integer
problem_categories.owner_role_id FK -> roles.id       plain integer
===============================  ===================  =====================

This revision closes those five gaps. It also re-creates any of the ten
foreign-key indexes that the old startup code used to guarantee on every boot,
since that startup code is being removed. After it runs, a database that grew
the old way and a database created fresh from the baseline are structurally
identical -- verified by comparing both schemas column by column, constraint by
constraint and index by index.

IT IS SAFE TO RUN TWICE
=======================

Every step checks the current state first and skips itself if the work is already
done. Running it on an already-correct database changes nothing.

IT REFUSES RATHER THAN GUESSES
==============================

Two situations make it stop with an explanation instead of carrying on:

1. **Orphaned references.** Before adding a foreign key it looks for rows that
   point at a parent row that no longer exists -- for example an ``hc_tasks``
   row whose ``reviewed_by`` names a user who was deleted. Adding the constraint
   would fail anyway, and the tempting "fix" of quietly setting those values to
   NULL would erase who reviewed a health check. So it stops and lists exactly
   which rows are affected, and a human decides what they should say.

2. **Timestamps it cannot interpret with confidence.** See below.

THE TIMESTAMP CONVERSION, AND WHY IT CHECKS BEFORE CONVERTING
=============================================================

``timestamp`` stores a wall-clock reading with no record of which clock it came
from. ``timestamptz`` stores an actual instant. Converting one to the other means
declaring which clock the stored readings were on, and getting that wrong shifts
every affected date -- here, health-check review dates and assignment return
dates, which carry contractual weight.

The expected answer is UTC. The application builds timezone-aware UTC datetimes,
and psycopg drops the timezone when the destination column has no zone, so what
landed in these columns should be UTC wall-clock -- *not* Tehran local time.

Rather than trust that reasoning, the migration measures it. ``updated_at`` on
the same row is a ``timestamptz`` written by the same code path at the same
moment as the review or the return, so the gap between the two tells us which
clock the naive column was on: about zero means UTC, about 3 hours 30 minutes
means Tehran local.

The three possible outcomes:

* **No rows to interpret** -- the column holds no values yet. There is nothing
  to shift, so the conversion is declared as UTC and the column type is fixed.
* **The evidence says UTC** (or Tehran) consistently -- convert using that zone.
* **The evidence disagrees with itself** -- stop, and report what was measured.
  Mixed offsets mean the data came from more than one source and no single
  conversion is right for all of it. That needs a person, not a migration.

Whatever it decides is printed while it runs, so the deployment log records how
the dates on the live system were interpreted.

PostgreSQL only
===============

The repair applies to PostgreSQL. On SQLite -- which the test suite uses -- the
baseline revision already creates every table correctly from the models, so
there is no drift to repair and this revision does nothing.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "b7f1c2d9e4a3"
down_revision = "97e73674816a"
branch_labels = None
depends_on = None


# child table, child column, parent table, parent column.
# The constraint name matches what PostgreSQL chooses on its own when the
# baseline creates the table, so a repaired database and a fresh one end up
# with identically-named constraints.
_FOREIGN_KEYS = [
    ("hc_tasks", "reviewed_by", "users", "id"),
    ("work_items", "dt_sc_contractor_id", "contractors", "id"),
    ("problem_categories", "owner_role_id", "roles", "id"),
]

# table, naive column to convert, timestamptz column to compare it against.
_TIMESTAMP_COLUMNS = [
    ("hc_tasks", "reviewed_at", "updated_at"),
    ("assignments", "returned_at", "updated_at"),
]

# Indexes that the old startup code re-created on every boot via
# ADDITIVE_INDEXES. They are all declared on the ORM models now, so the
# baseline creates them for any new database -- but a legacy database that was
# already stamped at 97e73674816a never runs the baseline, and the startup code
# that used to guarantee them is being removed. So the repair guarantees them
# once, here, instead.
#
# PostgreSQL does not index foreign keys automatically the way it does primary
# keys, and these columns carry the row-level-security joins and the chart
# grouping, so their cost grows with every month of imported data.
#
# index name -> (table, column)
_INDEXES = {
    "ix_sites_province_id": ("sites", "province_id"),
    "ix_sites_region_id": ("sites", "region_id"),
    "ix_work_items_site_id": ("work_items", "site_id"),
    "ix_work_items_dt_sc_contractor_id": ("work_items", "dt_sc_contractor_id"),
    "ix_villages_work_item_id": ("villages", "work_item_id"),
    "ix_acceptances_village_id": ("acceptances", "village_id"),
    "ix_health_checks_work_item_id": ("health_checks", "work_item_id"),
    "ix_assignments_work_item_id": ("assignments", "work_item_id"),
    "ix_assignments_contractor_id": ("assignments", "contractor_id"),
    "ix_drive_tests_work_item_id": ("drive_tests", "work_item_id"),
}

# How far from a candidate zone offset the measured gap may sit and still count
# as that zone. Review and return actions write both columns within the same
# transaction, so in practice the gap is well under a second; a generous five
# minutes absorbs any long-running request without admitting a wrong zone
# (the two candidates are 3.5 hours apart).
_TOLERANCE_SECONDS = 300

_CANDIDATE_ZONES = [
    ("UTC", 0),
    ("Asia/Tehran", 3.5 * 3600),
]


def _table_exists(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _column_exists(table: str, column: str) -> bool:
    if not _table_exists(table):
        return False
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _has_foreign_key(table: str, column: str) -> bool:
    """True if *column* already participates in any foreign key on *table*."""
    if not _table_exists(table):
        return False
    for fk in sa.inspect(op.get_bind()).get_foreign_keys(table):
        if column in fk.get("constrained_columns", []):
            return True
    return False


def _is_timezone_aware(table: str, column: str) -> bool:
    for col in sa.inspect(op.get_bind()).get_columns(table):
        if col["name"] == column:
            return bool(getattr(col["type"], "timezone", False))
    raise RuntimeError(f"{table}.{column} does not exist")


def _check_for_orphans(child: str, child_col: str, parent: str, parent_col: str) -> None:
    """Abort if any child row points at a parent row that is not there."""
    orphans = (
        op.get_bind()
        .execute(
            sa.text(
                f"SELECT DISTINCT c.{child_col} AS missing_id, count(*) AS row_count "
                f"FROM {child} c "
                f"WHERE c.{child_col} IS NOT NULL "
                f"  AND NOT EXISTS (SELECT 1 FROM {parent} p WHERE p.{parent_col} = c.{child_col}) "
                f"GROUP BY c.{child_col} ORDER BY c.{child_col}"
            )
        )
        .fetchall()
    )
    if not orphans:
        return

    detail = "\n".join(
        f"    {child}.{child_col} = {row.missing_id} "
        f"({row.row_count} row{'s' if row.row_count != 1 else ''}) "
        f"-- no {parent} row has {parent_col} = {row.missing_id}"
        for row in orphans
    )
    raise RuntimeError(
        f"\n\nCannot add the foreign key {child}.{child_col} -> {parent}.{parent_col}.\n\n"
        f"Some rows in '{child}' point at a '{parent}' record that no longer exists:\n\n"
        f"{detail}\n\n"
        "This usually means a record was deleted while history still referred to it.\n"
        "The migration has stopped and changed nothing. It will not guess what those\n"
        "rows should say, because clearing them would erase part of the audit trail.\n\n"
        "See the 'When the migration reports orphaned rows' section of\n"
        "MIGRATION-RUNBOOK.md for what to do next.\n"
    )


def _measure_source_timezone(table: str, naive_col: str, reference_col: str) -> str:
    """Work out which clock the naive column's values were recorded on.

    Returns the zone name to convert from. Raises if the stored values do not
    agree with each other, because no single conversion would then be correct.
    """
    rows = (
        op.get_bind()
        .execute(
            sa.text(
                f"SELECT EXTRACT(EPOCH FROM ({naive_col} - ({reference_col} AT TIME ZONE 'UTC'))) "
                f"AS offset_seconds "
                f"FROM {table} "
                f"WHERE {naive_col} IS NOT NULL AND {reference_col} IS NOT NULL"
            )
        )
        .fetchall()
    )

    if not rows:
        print(
            f"    {table}.{naive_col}: no values stored yet, so there are no dates "
            f"to shift. Converting as UTC."
        )
        return "UTC"

    offsets = [float(r.offset_seconds) for r in rows]

    for zone, expected in _CANDIDATE_ZONES:
        if all(abs(o - expected) <= _TOLERANCE_SECONDS for o in offsets):
            print(
                f"    {table}.{naive_col}: {len(offsets)} value(s) checked against "
                f"{reference_col}; measured offset {min(offsets):.0f}..{max(offsets):.0f}s "
                f"matches {zone}. Converting as {zone}."
            )
            return zone

    raise RuntimeError(
        f"\n\nCannot safely convert {table}.{naive_col} to a timezone-aware column.\n\n"
        f"To convert it, the migration must know which clock the stored readings were\n"
        f"taken on. It checks by comparing each value against {reference_col} on the same\n"
        f"row, which does record its timezone. Those comparisons should all agree.\n"
        f"They do not:\n\n"
        f"    rows checked:   {len(offsets)}\n"
        f"    smallest gap:   {min(offsets):.0f} seconds\n"
        f"    largest gap:    {max(offsets):.0f} seconds\n"
        f"    expected:       0 seconds if the values are UTC,\n"
        f"                    12600 seconds if they are Tehran local time\n\n"
        "Mixed results mean these dates came from more than one source, so no single\n"
        "conversion is right for all of them. The migration has stopped and changed\n"
        "nothing.\n\n"
        "See the 'When the migration cannot read the dates' section of\n"
        "MIGRATION-RUNBOOK.md for what to do next.\n"
    )


def upgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name != "postgresql":
        # SQLite (the test suite) builds its schema from the baseline, which
        # already matches the models. There is no legacy drift to repair.
        return

    print("Checking whether this database needs the legacy schema repair...")

    # --- Foreign keys -------------------------------------------------------
    for child, child_col, parent, parent_col in _FOREIGN_KEYS:
        if not _column_exists(child, child_col):
            continue
        if _has_foreign_key(child, child_col):
            print(f"    {child}.{child_col}: foreign key already present, skipping.")
            continue

        _check_for_orphans(child, child_col, parent, parent_col)
        op.create_foreign_key(
            f"{child}_{child_col}_fkey", child, parent, [child_col], [parent_col]
        )
        print(f"    {child}.{child_col}: added foreign key -> {parent}.{parent_col}.")

    # --- Timestamps ---------------------------------------------------------
    for table, naive_col, reference_col in _TIMESTAMP_COLUMNS:
        if not _column_exists(table, naive_col):
            continue
        if _is_timezone_aware(table, naive_col):
            print(f"    {table}.{naive_col}: already timezone-aware, skipping.")
            continue

        zone = _measure_source_timezone(table, naive_col, reference_col)
        op.execute(
            sa.text(
                f"ALTER TABLE {table} "
                f"ALTER COLUMN {naive_col} TYPE TIMESTAMP WITH TIME ZONE "
                f"USING {naive_col} AT TIME ZONE '{zone}'"
            )
        )
        print(f"    {table}.{naive_col}: converted to timestamptz using {zone}.")

    # --- Indexes ------------------------------------------------------------
    inspector = sa.inspect(bind)
    for index_name, (table, column) in _INDEXES.items():
        if not _column_exists(table, column):
            continue
        if index_name in {ix["name"] for ix in inspector.get_indexes(table)}:
            continue
        op.create_index(index_name, table, [column], unique=False)
        print(f"    {table}.{column}: created missing index {index_name}.")

    print("Legacy schema repair complete.")


def downgrade() -> None:
    """Undo the repair: drop the added foreign keys, drop the timezones again.

    This exists so the revision is reversible, but going back means returning to
    a schema that disagrees with the models, and the timestamp half is lossy --
    once the zone is dropped the instants become bare wall-clock readings again.
    No row is deleted either way.
    """
    bind = op.get_bind()

    if bind.dialect.name != "postgresql":
        return

    for table, naive_col, _reference_col in _TIMESTAMP_COLUMNS:
        if _column_exists(table, naive_col) and _is_timezone_aware(table, naive_col):
            op.execute(
                sa.text(
                    f"ALTER TABLE {table} "
                    f"ALTER COLUMN {naive_col} TYPE TIMESTAMP WITHOUT TIME ZONE "
                    f"USING {naive_col} AT TIME ZONE 'UTC'"
                )
            )

    for child, child_col, _parent, _parent_col in _FOREIGN_KEYS:
        if _column_exists(child, child_col) and _has_foreign_key(child, child_col):
            op.drop_constraint(f"{child}_{child_col}_fkey", child, type_="foreignkey")
