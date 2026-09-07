"""The final five problem categories, renamed in place.

The categories became: Managed Service, CPG Project, NWG RND, Huawei Cleanup,
Temp Power. Four of the five already existed under other names, so this
migration **renames the existing rows** rather than deleting and re-creating
them::

    Temporary Power        -> Temp Power             (CPG Power,      7 days)
    Project Responsibility -> CPG Project            (CPG Rollout PM, 7 days)
    MS Responsibility      -> Managed Service        (Managed Service, 10 days)
    NWG Responsibility     -> NWG RND                (NWG Planning,   14 days)
                              Huawei Cleanup  (new)  (Huawei Cleanup,  7 days)

Renaming is not a stylistic preference here, it is the only safe option.
``hc_remediations.problem_category_id`` and ``reroute_to_category_id`` point at
these rows, and every historical round in a site's timeline is read back
through them. Dropping the four and inserting five fresh ones would orphan
every open fix and blank the category on every health check ever recorded.

``hc_tasks.problem_category`` holds a denormalised, comma-joined copy of the
names for the screens and exports that show a single string. Those are updated
too, by substring replacement over that column, so a site triaged before this
migration does not read one name in its history and another in its fix queue.

The new **Huawei Cleanup** category needs an owning role, or it would open
fixes that appear in nobody's queue. The role is created here with
``is_category_owner = true``, which is what every permission check keys off;
users are assigned to it by an administrator afterwards.

This migration is written to be re-runnable in either direction. Renames are
guarded on the source name still being present, so an installation already
carrying the new names (a fresh database seeded by ``bootstrap``) is untouched.

Revision ID: d8f4a13c6e07
Revises: c1b9e4a72f38
Create Date: 2026-09-07
"""
from alembic import op
import sqlalchemy as sa

revision = "d8f4a13c6e07"
down_revision = "c1b9e4a72f38"
branch_labels = None
depends_on = None


# old name -> (new name, owning role, SLA days)
RENAMES = [
    ("Temporary Power", "Temp Power", "CpgPower", 7),
    ("Project Responsibility", "CPG Project", "CpgRolloutPM", 7),
    ("MS Responsibility", "Managed Service", "ManagedService", 10),
    ("NWG Responsibility", "NWG RND", "NwgPlanning", 14),
]

NEW_ROLE = "HuaweiCleanup"
NEW_CATEGORY = ("Huawei Cleanup", NEW_ROLE, 7)


def _role_id(conn, name):
    return conn.execute(
        sa.text("SELECT id FROM roles WHERE name = :n"), {"n": name}
    ).scalar()


def _category_id(conn, name):
    return conn.execute(
        sa.text("SELECT id FROM problem_categories WHERE name = :n"), {"n": name}
    ).scalar()


def _rename_category(conn, old, new):
    """Rename one category row and fix the denormalised copies of its name.

    Returns False when there is nothing to do -- either the old name is gone
    (already migrated) or the new name is somehow already taken, in which case
    renaming would collide with the unique constraint on ``name``.
    """
    if _category_id(conn, old) is None or _category_id(conn, new) is not None:
        return False
    conn.execute(
        sa.text("UPDATE problem_categories SET name = :new WHERE name = :old"),
        {"new": new, "old": old},
    )
    # hc_tasks.problem_category is a comma-joined summary string, not a key.
    # REPLACE is available on both PostgreSQL and SQLite.
    conn.execute(
        sa.text(
            "UPDATE hc_tasks SET problem_category = "
            "REPLACE(problem_category, :old, :new) "
            "WHERE problem_category LIKE :like"
        ),
        {"old": old, "new": new, "like": f"%{old}%"},
    )
    return True


def upgrade() -> None:
    conn = op.get_bind()

    for old, new, role_name, sla in RENAMES:
        if not _rename_category(conn, old, new):
            continue
        role_id = _role_id(conn, role_name)
        conn.execute(
            sa.text(
                "UPDATE problem_categories SET sla_days = :sla, "
                "owner_role_id = COALESCE(owner_role_id, :role) WHERE name = :n"
            ),
            {"sla": sla, "role": role_id, "n": new},
        )

    # The fifth category and the role that owns it.
    if _role_id(conn, NEW_ROLE) is None:
        conn.execute(
            sa.text(
                "INSERT INTO roles (name, is_category_owner, created_at, "
                "updated_at) VALUES (:n, true, CURRENT_TIMESTAMP, "
                "CURRENT_TIMESTAMP)"
            ),
            {"n": NEW_ROLE},
        )

    name, role_name, sla = NEW_CATEGORY
    if _category_id(conn, name) is None:
        conn.execute(
            sa.text(
                "INSERT INTO problem_categories "
                "(name, active, owner_role_id, sla_days, created_at, updated_at) "
                "VALUES (:n, true, :role, :sla, CURRENT_TIMESTAMP, "
                "CURRENT_TIMESTAMP)"
            ),
            {"n": name, "role": _role_id(conn, role_name), "sla": sla},
        )


def downgrade() -> None:
    """Rename back, and drop Huawei Cleanup if nothing has used it yet.

    The category is only removed when no remediation references it, in either
    direction. A downgrade must not destroy a fix somebody is working, or the
    record of one they finished -- if any exist the category is deactivated
    instead, which hides it from the pickers while leaving the history intact.
    """
    conn = op.get_bind()

    name = NEW_CATEGORY[0]
    cat_id = _category_id(conn, name)
    if cat_id is not None:
        in_use = conn.execute(
            sa.text(
                "SELECT COUNT(*) FROM hc_remediations WHERE "
                "problem_category_id = :id OR reroute_to_category_id = :id"
            ),
            {"id": cat_id},
        ).scalar()
        if in_use:
            conn.execute(
                sa.text(
                    "UPDATE problem_categories SET active = false WHERE id = :id"
                ),
                {"id": cat_id},
            )
        else:
            conn.execute(
                sa.text("DELETE FROM problem_categories WHERE id = :id"),
                {"id": cat_id},
            )

    for old, new, _role, _sla in RENAMES:
        _rename_category(conn, new, old)
