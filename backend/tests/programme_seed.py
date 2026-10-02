"""A deliberately untidy programme, shared by the queue parity tests.

Sites in and out of the on-air stages, drive tests done and not, several
completed rounds per site, ties in completion time, open and closed fixes,
disputed categories, duplicate active assignments, drive tests in every
status, deleted sites, and sites in a province the scoped user cannot see --
plus one user per kind of scope rule (PM, a one-province coordinator, two
contractors, a category owner).

Used by ``test_queue_count_parity`` (badges against lists) and
``test_action_board`` (tickets against the screens they open).
"""
from datetime import datetime, timedelta, timezone

from app.core import user_status
from app.core.deps import CONTRACTOR, COORDINATOR, CPG_POWER, PM
from app.services import cpm_columns as C

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def seed_programme(db, rng, sites=160):
    from app.models.health_check import (
        HcAssignment,
        HcRemediation,
        HcTask,
    )
    from app.models.reference import Contractor, ProblemCategory, Province, Role, User
    from app.models.workitem import Assignment, DriveTest, Site, WorkItem

    contractors = [Contractor(name=f"Parity Co {n}", type="drive_test") for n in range(2)]
    db.add_all(contractors)
    db.flush()

    home, away = db.query(Province).order_by(Province.id).limit(2).all()
    categories = db.query(ProblemCategory).order_by(ProblemCategory.id).all()
    roles = {r.name: r for r in db.query(Role).all()}

    def user(username, role, **kw):
        u = User(
            username=username, password_hash="x", first_name=username,
            family_name="Parity", role_id=roles[role].id,
            status=user_status.ACTIVE, **kw,
        )
        db.add(u)
        return u

    user("p_pm", PM, sees_all_provinces=True)
    scoped = user("p_coord_home", COORDINATOR, sees_all_provinces=False)
    scoped.provinces = [home]
    user("p_sc0", CONTRACTOR, sees_all_provinces=False, contractor_id=contractors[0].id)
    user("p_sc1", CONTRACTOR, sees_all_provinces=False, contractor_id=contractors[1].id)
    user("p_power", CPG_POWER, sees_all_provinces=True)
    db.flush()

    stages = [C.STAGE_PERM_ONAIR, C.STAGE_TEMP_ONAIR, "perm on air", None, "Construction"]
    dt_statuses = [None, "Done", "done ", "Ongoing", "Problematic"]
    hc_assignments = [
        HcAssignment(
            code=f"PAR-{n}", contractor_id=rng.choice(contractors).id,
            # Half long outstanding, half within the late line, so the late
            # count has both kinds to tell apart.
            assigned_at=(
                T0 + timedelta(days=n)
                if n % 2
                else datetime.now(timezone.utc) - timedelta(days=n)
            ),
            status="Open",
        )
        for n in range(8)
    ]
    db.add_all(hc_assignments)
    db.flush()

    for n in range(sites):
        site = Site(site_code=f"PAR-{n:04d}", province_id=(home if n % 3 else away).id)
        db.add(site)
        db.flush()
        wi = WorkItem(
            site_id=site.id, site_type="Greenfield", requested_technology="2G/4G",
            last_stage=rng.choice(stages), dt_status=rng.choice(dt_statuses),
            dt_sc_contractor_id=rng.choice([None, contractors[0].id]),
            deleted_at=T0 if n % 23 == 0 else None,
        )
        db.add(wi)
        db.flush()

        # Health-check rounds: some completed (with repeated completion
        # times, to exercise the tie rule), maybe one still open.
        # A site is in an assignment at most once, so each round draws its
        # own assignment.
        rounds = iter(rng.sample(hc_assignments, 4))
        completed_times = [T0 + timedelta(days=rng.choice([1, 2, 2, 3])) for _ in range(rng.randint(0, 3))]
        for i, when in enumerate(completed_times):
            result = rng.choice(["Ready", "NotReady"])
            task = HcTask(
                hc_assignment_id=next(rounds).id, work_item_id=wi.id,
                round_no=i + 1, overall_result=result, completed_at=when,
                reviewed_at=when if rng.random() < 0.6 else None,
            )
            db.add(task)
            db.flush()
            if result == "NotReady" and rng.random() < 0.7:
                # One fix per category per task.
                for cat in rng.sample(categories, rng.randint(1, 2)):
                    db.add(HcRemediation(
                        hc_task_id=task.id, work_item_id=wi.id,
                        problem_category_id=cat.id, owner_role_id=cat.owner_role_id,
                        opened_at=when, due_at=when + timedelta(days=7),
                        closed_at=when if rng.random() < 0.5 else None,
                        reroute_to_category_id=(
                            rng.choice(categories).id if rng.random() < 0.3 else None
                        ),
                        reroute_at=when,
                    ))
        if rng.random() < 0.3:
            db.add(HcTask(
                hc_assignment_id=next(rounds).id, work_item_id=wi.id,
                round_no=len(completed_times) + 1,
            ))

        # Drive-test assignments: none, one, or two active at once, some
        # handed back, some inactive history.
        for _ in range(rng.choice([0, 0, 1, 1, 2])):
            db.add(Assignment(
                work_item_id=wi.id, assignment_type="official",
                contractor_id=rng.choice(contractors).id, assigned_at=T0,
                is_active=rng.random() < 0.8,
                returned_at=T0 if rng.random() < 0.25 else None,
            ))
        for _ in range(rng.choice([0, 0, 1, 2])):
            db.add(DriveTest(
                work_item_id=wi.id,
                status=rng.choice(["Submitted", "Approved", "Rejected", "Returned"]),
                submitted_at=T0, is_active=rng.random() < 0.8,
            ))
        db.flush()
    db.commit()
