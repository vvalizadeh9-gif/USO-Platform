# Admin

## Contractors (UEP-31)

**Admin › Contractors** (`/admin/contractors`) decides which drive-test contractors appear in Drive test. PM and Admin edit; Viewer reads. PMs open it from the Data app.

### How visibility works

- Every drive-test contractor has a **Show in Drive test** switch (`contractors.show_in_drive_test`).
- The **Contractors** column on Health check · Assign and Drive test · Assign lists only switched-on contractors, A to Z, each with their basket (sites with them now).
- Hiding a contractor takes them out of those columns and nothing else: their open sites, their history and their login stay. Switch them back on at any time. Every switch is audit-logged (who, when, before and after) and can be undone from the toast.
- This switch is separate from `active`, which search, the data import, Monthly Plan and analytics read.

### Where contractors come from

- **The CPM import** (DT SC column) creates a contractor the first time it sees a name. A **new name arrives hidden**, so an old or misspelt name never reaches the Assign columns on its own. The one exception is the first import on an empty system, where nobody is shown yet: those names are shown.
- The import never changes a contractor it already knows.
- When hidden CPM names have arrived since you last opened the page, the page says so ("2 new names from the 27 Nov CPM import are hidden.") and **Review** opens the Hidden tab.
- **Add contractor** creates one by hand: shown at once, source "Added by hand". A name that already exists, whatever its case or spacing, is refused.

### The columns

| Column | Shows |
|---|---|
| Contractor | the name |
| Source | CPM, CPM · new {date}, or Added by hand |
| Works in | the provinces learned from their last 90 days of work (read only) |
| Open now | health checks plus drive tests with them now; red for a hidden contractor who still has open work |
| Show in Drive test | the switch |

### The first deploy

The UEP-31 migration hides drive-test contractors with no health check and no drive test assigned in the last 180 days and no open work, and writes their names to the migration log. Agree the list of contractors that stay shown with the PM before it runs on production; anyone hidden by mistake is one switch away.
