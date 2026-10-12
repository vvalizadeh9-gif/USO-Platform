"""The pending-work queue registry and everything built on it.

It feeds Home, the app rail counts, the daily digest and the Admin SLA
settings.


* ``types``    -- QueueDefinition, PendingItem and the shared vocabulary;
* ``registry`` -- every queue, defined once;
* ``sla``      -- overdue rules and the 1 Mehr 1405 tracking epoch;
* ``board``    -- queue summaries and the scope label;
* ``sources``  -- adapters over each queue screen's own list function.
"""
