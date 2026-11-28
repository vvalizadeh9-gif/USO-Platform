"""UEP-29: Admin > Data import -- drive test and acceptance data from Excel.

One sheet, one row per village, keyed on site ID + site type + village code.
The flow is template -> upload (preview, nothing written) -> decide every
conflict -> Confirm (one transaction) -> optionally Undo the whole batch.

Modules, each small and with one job:

* ``columns``   the template's columns: header text, key, group, kind
* ``template``  the workbook UEP hands out (keys as text, dropdowns)
* ``reader``    reading a filled file by header name, dates (Gregorian/Shamsi)
* ``current``   what UEP holds today, loaded in bulk, with each value's source
* ``validate``  the row rules, and grouping drive test values per work item
* ``diff``      New / No change / Conflict per field
* ``apply_dt``, ``apply_acceptance``   Confirm, through the existing services
* ``undo``      reversing a batch where nothing changed since
* ``batches``   numbering, staging, decisions, expiry, history
* ``exports``   the error file and the change log
"""
