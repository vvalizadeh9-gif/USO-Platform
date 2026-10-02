"""The Action Center's queue registry and everything built on it.

* ``types``    -- QueueDefinition, PendingItem and the shared vocabulary;
* ``registry`` -- every queue, defined once;
* ``sla``      -- overdue rules and the 1 Mehr 1405 tracking epoch;
* ``board``    -- the board, the per-owner breakdown and queue summaries;
* ``sources``  -- adapters over each queue screen's own list function.
"""
