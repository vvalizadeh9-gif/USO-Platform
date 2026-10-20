"""Province assignments (UEP-17): one coordinator per CRA region.

* ``province_assignment_history``.
* Consistency check: every province of a CRA region must name the same
  coordinator in ``provinces.coordinator_user_id`` and in the open
  ``province_mapping`` row's ``pso_coordinator``. Where they disagree, the
  coordinator holding most of the region's provinces (counting both stores)
  wins; on a tie, the one ``province_mapping`` names. Both stores are written
  to match, the owner is granted the region's provinces, and every fix is
  printed. Other coordinators' grants inside a region are reported, not
  removed: nobody loses access on deploy, and the region's next Update moves
  them.
* One ``System`` history entry records the owners as found.

Regional managers and the province -> region link are not touched.

Revision ID: a3c9e6f1d274
Revises: d6f2b8e4a915
Create Date: 2026-10-20
"""
import uuid
from collections import Counter
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "a3c9e6f1d274"
down_revision = "d6f2b8e4a915"
branch_labels = None
depends_on = None

#: Copied, not imported: a migration must not change when app code does.
COORDINATOR_ROLE = "Coordinator"
ACTIVE = "Active"


def _timestamps() -> list[sa.Column]:
    """The ``created_at`` / ``updated_at`` every model inherits from Base."""
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    # Guarded: a database built by create_all already has the table.
    if "province_assignment_history" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "province_assignment_history",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("change_id", sa.Uuid, nullable=False),
            sa.Column("cra_region", sa.String(60), nullable=False),
            sa.Column("old_coordinator_user_id", sa.Integer, sa.ForeignKey("users.id")),
            sa.Column("new_coordinator_user_id", sa.Integer, sa.ForeignKey("users.id")),
            sa.Column("changed_by", sa.Integer, sa.ForeignKey("users.id")),
            sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
            *_timestamps(),
        )
        op.create_index(
            "ix_province_assignment_history_change_id",
            "province_assignment_history", ["change_id"],
        )

    owners = reconcile(op.get_bind())
    if owners and not op.get_bind().execute(
        sa.text("SELECT 1 FROM province_assignment_history LIMIT 1")
    ).first():
        _write_system_entry(owners)


def downgrade() -> None:
    # The consistency fixes stay: they made two stores agree, and undoing
    # them would only restore the disagreement.
    op.drop_index("ix_province_assignment_history_change_id", "province_assignment_history")
    op.drop_table("province_assignment_history")


# ------------------------------------------------------------------ check --
def reconcile(bind) -> dict[str, int | None]:
    """Make both stores agree per region; print every fix. Returns each
    region's owner account id (None for a coordinator with no account)."""
    rows = bind.execute(sa.text(
        "SELECT id, province_fa, province_en, cra_region, pso_coordinator "
        "FROM province_mapping WHERE effective_to IS NULL"
    )).all()
    if not rows:
        return {}
    provinces = {
        name: (pid, coordinator)
        for pid, name, coordinator in bind.execute(
            sa.text("SELECT id, name, coordinator_user_id FROM provinces")
        ).all()
    }
    accounts = bind.execute(sa.text(
        "SELECT u.id, u.kpi_person_name, u.status, u.sees_all_provinces "
        "FROM users u JOIN roles r ON r.id = u.role_id "
        "WHERE r.name = :role ORDER BY u.id"
    ), {"role": COORDINATOR_ROLE}).all()
    person_name = {a.id: a.kpi_person_name for a in accounts if a.kpi_person_name}
    linked: dict[str, int] = {}
    for a in accounts:
        if a.kpi_person_name and a.status == ACTIVE:
            linked.setdefault(a.kpi_person_name.casefold(), a.id)
    sees_all = {a.id for a in accounts if a.sees_all_provinces}
    coordinator_ids = [a.id for a in accounts]

    by_region: dict[str, list] = {}
    for row in rows:
        by_region.setdefault(row.cra_region, []).append(row)

    fixes: list[str] = []
    owners: dict[str, int | None] = {}
    for region in sorted(by_region):
        region_rows = sorted(by_region[region], key=lambda r: r.province_en)
        name, uid = _winner(region_rows, provinces, linked, person_name)
        owners[region] = uid
        fixes += _write_region(bind, region, region_rows, provinces, name, uid)
        fixes += _grant_region(bind, region, region_rows, provinces, uid, sees_all, coordinator_ids)

    print("UEP-17 province assignments: consistency check")
    if fixes:
        for line in fixes:
            print(f"    {line}")
    else:
        print(f"    all {len(owners)} CRA regions already consistent")
    return owners


def _winner(rows, provinces, linked, person_name) -> tuple[str, int | None]:
    """The coordinator holding most of the region's provinces across both
    stores; ties go to the one ``province_mapping`` names. An account with no
    ``kpi_person_name`` cannot be written to the mapping, so it cannot win."""
    def person(name: str):
        uid = linked.get(name.casefold())
        return ("user", uid) if uid else ("name", name)

    votes: Counter = Counter()
    mapping_votes: Counter = Counter()
    for row in rows:
        key = person(row.pso_coordinator)
        votes[key] += 1
        mapping_votes[key] += 1
        held = provinces.get(row.province_fa, (None, None))[1]
        if held:
            votes[("user", held)] += 1

    eligible = [k for k in votes if k[0] == "name" or k[1] in person_name]
    best = max(eligible, key=lambda k: (votes[k], mapping_votes[k], str(k)))
    if best[0] == "name":
        return best[1], None
    return person_name[best[1]], best[1]


def _write_region(bind, region, rows, provinces, name, uid) -> list[str]:
    fixes = []
    for row in rows:
        if row.pso_coordinator != name:
            bind.execute(sa.text(
                "UPDATE province_mapping SET pso_coordinator = :n WHERE id = :id"
            ), {"n": name, "id": row.id})
            fixes.append(
                f"{region} / {row.province_en}: province_mapping.pso_coordinator "
                f"{row.pso_coordinator!r} -> {name!r}"
            )
        pid, held = provinces.get(row.province_fa, (None, None))
        if pid is not None and held != uid:
            bind.execute(sa.text(
                "UPDATE provinces SET coordinator_user_id = :u WHERE id = :id"
            ), {"u": uid, "id": pid})
            fixes.append(
                f"{region} / {row.province_en}: provinces.coordinator_user_id "
                f"{held} -> {uid}"
            )
    return fixes


def _grant_region(bind, region, rows, provinces, uid, sees_all, coordinator_ids) -> list[str]:
    """Grant the owner the region's provinces; report other coordinators'."""
    ids = [provinces[r.province_fa][0] for r in rows if r.province_fa in provinces]
    if not ids or not coordinator_ids:
        return []
    held = bind.execute(
        sa.text(
            "SELECT user_id, province_id FROM user_province_access "
            "WHERE province_id IN :p AND user_id IN :u"
        ).bindparams(sa.bindparam("p", expanding=True), sa.bindparam("u", expanding=True)),
        {"p": ids, "u": coordinator_ids},
    ).all()
    lines = []
    if uid is not None and uid not in sees_all:
        have = {p for u, p in held if u == uid}
        missing = [p for p in ids if p not in have]
        for pid in missing:
            bind.execute(sa.text(
                "INSERT INTO user_province_access (user_id, province_id) VALUES (:u, :p)"
            ), {"u": uid, "p": pid})
        if missing:
            lines.append(f"{region}: granted user {uid} provinces {missing}")
    strays = sorted({u for u, _p in held if u != uid})
    if strays:
        lines.append(
            f"{region}: users {strays} also hold grants here (left as they are; "
            "the region's next Update removes them)"
        )
    return lines


def _write_system_entry(owners: dict[str, int | None]) -> None:
    history = sa.table(
        "province_assignment_history", sa.column("change_id", sa.Uuid),
        sa.column("cra_region"), sa.column("old_coordinator_user_id"),
        sa.column("new_coordinator_user_id"), sa.column("changed_at"),
    )
    change_id, now = uuid.uuid4(), datetime.now(timezone.utc)
    op.bulk_insert(history, [
        {"change_id": change_id, "cra_region": region, "old_coordinator_user_id": uid,
         "new_coordinator_user_id": uid, "changed_at": now}
        for region, uid in owners.items()
    ])
