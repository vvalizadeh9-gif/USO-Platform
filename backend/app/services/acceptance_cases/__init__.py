"""Acceptance cases (UEP-22): one ICT and one CRA case per village.

Small modules, each with one job:

* ``rules``    -- the definitions: days in basket, stale comment, age bucket,
  basket key and label. Pure functions, no database.
* ``scope``    -- the universe, who sees which cases, and the one case read.
* ``sync``     -- creates the cases a village is owed (and backfills them
  from the existing acceptance data the first time).
* ``counts``   -- every number: inbox tabs, the rail, Home and Baskets.
* ``inbox``    -- the Filing page's lists.
* ``update``   -- a save: comment, approved, rejected, fixed; basket change.
* ``history``  -- the timeline.
* ``baskets``  -- Insights > Acceptance baskets.
* ``validation_link`` -- what a filed or confirmed letter does to a case.
"""
