"""The Health check → Drive test pipeline, as one strip of counts.

Both work pages show the same strip: six steps, the DT done outcome and three
side loops. Every figure on it is a queue summarised by the shared queue
service (``action_queues.board.summarize``) -- the function Home and the rail
read -- so a step that also has a Home row shows exactly Home's number:

==============  =============================  ===========================
strip key       queue                          also on Home / the rail
==============  =============================  ===========================
``hc1``         ``hc_assign``                  yes
``hc2``         sites out with an HC company   no (pipeline only)
``hc3``         ``hc_review``                  yes
``dt4``         ``dt_assign``                  yes
``dt5``         sites with a DT contractor     no (pipeline only)
``dt6``         ``dt_review``                  yes
``done``        on-air sites with DT Done      no (an outcome, never late)
``remediation`` open fixes, every category     no (pipeline only)
``reroutes``    ``hc_reroutes``                yes
``sent_back``   drive tests sent back          no (pipeline only)
==============  =============================  ===========================

The pipeline-only queues are defined here rather than in the registry: they
are work waiting on *somebody else* (a contractor, an owning team), so they
belong on neither Home nor the digest. Their SLA rows live in the same
``action_queue_sla`` table under their own keys, and default to the same 14
days until an administrator sets one.
"""
from __future__ import annotations

from app.services.action_queues import board, sla
from app.services.action_queues.context import QueueContext
from app.services.action_queues.registry import QUEUES_BY_KEY
from app.services.action_queues.sources import lifecycle
from app.services.action_queues.types import QueueDefinition, SlaKind, Stage
from app.services.drive_test_analytics import DriveTestAnalytics, is_dt_done


def _pipeline_queue(key, stage, label, fetch, *, kind=SlaKind.CONFIGURED) -> QueueDefinition:
    return QueueDefinition(
        key=key, stage=stage, label=label, short_label=label, url="",
        roles=frozenset(), sla=kind, date_kind="since", fetch=fetch,
        on_board=False,
    )


#: Work held by somebody else, summarised the same way as Home's queues.
PIPELINE_ONLY: dict[str, QueueDefinition] = {
    q.key: q
    for q in (
        _pipeline_queue("hc_in_check", Stage.HC, "In health check", lifecycle.hc_to_submit),
        _pipeline_queue("dt_in_test", Stage.DT, "With contractor", lifecycle.sites_to_drive_test),
        _pipeline_queue("dt_sent_back", Stage.DT, "Sent back", lifecycle.returned_to_redo),
        _pipeline_queue(
            "hc_remediation", Stage.HC, "Remediation", lifecycle.fixes, kind=SlaKind.CATEGORY
        ),
    )
}

#: The strip, in order, and the queue behind each key. ``done`` has none.
STRIP: tuple[tuple[str, str | None], ...] = (
    ("hc1", "hc_assign"),
    ("hc2", "hc_in_check"),
    ("hc3", "hc_review"),
    ("dt4", "dt_assign"),
    ("dt5", "dt_in_test"),
    ("dt6", "dt_review"),
    ("done", None),
    ("remediation", "hc_remediation"),
    ("reroutes", "hc_reroutes"),
    ("sent_back", "dt_sent_back"),
)

STRIP_KEYS: tuple[str, ...] = tuple(key for key, _ in STRIP)


def queue_for(key: str) -> QueueDefinition:
    return QUEUES_BY_KEY.get(key) or PIPELINE_ONLY[key]


def sla_days_for(db, keys: list[str]) -> dict[str, int]:
    """The configured SLA of each queue key (Admin › SLA, default 14)."""
    return sla.sla_days_by_queue(db, keys)


def _done_count(ctx: QueueContext) -> int:
    """The DT site list's ``done`` bucket, counted the way it is listed."""
    return sum(1 for wi in DriveTestAnalytics(ctx.db, ctx.user).onair_items() if is_dt_done(wi))


def summary(ctx: QueueContext) -> dict[str, dict]:
    """Every strip key's ``count``, ``late``, ``oldest_days`` and ``sla_days``.

    ``sla_days`` is None where lateness is not a day count: a fix is late
    against its own due date, and DT done is never late.
    """
    keys = [queue for _, queue in STRIP if queue]
    days = sla_days_for(ctx.db, keys)
    out: dict[str, dict] = {}
    for strip_key, queue_key in STRIP:
        if queue_key is None:
            out[strip_key] = {
                "count": _done_count(ctx), "late": 0, "oldest_days": None, "sla_days": None,
            }
            continue
        queue = queue_for(queue_key)
        s = board.summarize(queue, queue.fetch(ctx), days[queue_key], ctx.now)
        oldest = s.oldest_started_at
        out[strip_key] = {
            "count": s.count,
            "late": s.overdue,
            "oldest_days": max(0, (ctx.now - oldest).days) if oldest else None,
            "sla_days": days[queue_key] if queue.sla is SlaKind.CONFIGURED else None,
        }
    return out
