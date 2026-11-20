"""Submissions to ICT HQ (UEP-21): what is ready, what went, what ICT confirmed.

UEP's own record (``submission_batches`` / ``submission_items``) is the source
of truth for "was this village sent". ICT HQ's Mojri tracker only confirms
receipt, and lags by about a month; a sent village that is still missing from
Mojri 30 days after it left moves to Follow up, and is never counted as unsent
again. See ARCHITECTURE.md §5e.

Modules, each small:

* ``scope``       the universe (live pure هدف, drive test done), who may act,
                  and the province scope of a read-only coordinator
* ``ready``       the Ready list and its reasons
* ``batches``     draft, remove, cancel, mark as sent, optional letters
* ``follow_up``   Mojri lateness, raise, send again
* ``excel``       the 18-column ICT workbook
* ``past_import`` batches #1-#39 from their Excel files
* ``sightings``   non-هدف village keys seen by CPM imports
* ``counts``      **the single source** for the tiles, rail, side panel and Home

Nothing here writes acceptance or drive tests, with one deliberate exception
outside this package: a brand-new هدف village on a DT-done site reopens its
drive test (``dt_workflow.reopen_for_new_villages``, called from the CPM hooks).
"""
