# Explorer

*For everyone who works on drive tests: PM, coordinators, contractors,
regional managers and viewers. Open it from the Drive test app's rail.*

Explorer is every site you can see, and one page per site that tells its
whole story: what the site is, where it is in UEP, how long each step took,
and where each of its villages stands with ICT and CRA.

Every date on Explorer is Gregorian, for example **6 Oct 2026**. The rest of
UEP still shows Shamsi dates.

## The list

Explorer opens on the list of every site you can see. Its job is to find one
site fast and open its record. The count beside the title is every site you
can see.

- **Search** (*Find a site by ID, village ID or village name*) narrows the
  list as you type: site ID, village ID, village name or province. Persian
  names match however the letters were typed. The matching part of a site ID
  is highlighted; when a site was found through one of its villages, that
  village is highlighted when you open the row's villages, and on the record
  page. **Esc** or **×** clears it.
- **Filter** filters by Province, Site type, Requested tech or DT contractor:
  choose a field, then a value. Each filter shows as a chip after the search;
  **×** on a chip removes it, and choosing the active value again does too.
- **Sort** by clicking a column header (Site, Province, Type, Technology,
  Villages, DT contractor); click it again to reverse. The list starts sorted
  by site ID.
- Search, filters and sort are in the page address, so you can share a view
  by sharing its link.

Each row shows the site ID, province, type (*New site* or *Add tech*), the
requested technologies, the number of the site's هدف villages, and the DT
contractor (*Not assigned* when there is none).

- **Click anywhere on a row** to open the site's record. The checkbox and the
  villages pill do not open it.
- **The villages pill** shows the site's هدف villages, name and ID, under the
  row. One row is open at a time.
- **More rows load by themselves** as you scroll to the end, fifty at a time.
  The footer says how many are shown. When you come back from a record, the
  list is where you left it.
- **Select rows** with their checkboxes (the header checkbox selects every row
  loaded so far). A bar appears at the bottom: **Export** downloads the
  selected sites, **Copy IDs** copies their site IDs, **×** clears the
  selection. The **Export** button at the top downloads the whole list as you
  see it, with its search, filters and sort.
- **Keyboard:** Tab to the first row, **↑** and **↓** move between rows,
  **Enter** opens the record.
- **History** beside Export lists your recent actions with Undo, as before.

Stage chips, numbered pages and bulk assignment are no longer on Explorer;
assign drive tests from the Drive test page. Old links to `/work-items` still
work and land here.

## A site's record

The header shows the site ID and one badge for where the site is now, for
example *Acceptance in progress*, or *Acceptance done* in green when every
village is fully approved.

- **Open in My Work** opens My Work searched to this site.
- **File letter** (contractors, coordinators and PM) opens My Work on this
  site's villages that still need a letter. It is shown while the site has
  open villages.
- **Take action** appears only when you have something to do on this site:
  assign it for a drive test, submit its drive test or hand it back, or review
  the submitted drive test. The forms are the same as before, in a side panel.

### General information

On air date, DT date, site contractor, DT contractor, requested technology,
province and the number of هدف villages. A dash means the value is not known
yet. The site contractor comes from the CPM file's *پیمانکار اجرایی سایت*
column and appears after the next CPM import.

### Journey

The five steps a site goes through, in the order they happen: **On air →
Health check → Assigned → DT done → Acceptance**. A finished step is a filled
blue circle with its date; the current step has a blue ring and says *In
progress*. On air is always the first step: a site goes on air, then it is
health-checked. Between two steps a pill shows how many days the step took
("+7 d"), and on the current step how long it has been going ("+8 d so far").

Sites imported from CPM before Mehr 1405 may have no dates for early steps.
Those steps read *No date*, and any number that needs the date shows a dash.
Some sites have a drive test dated before their on-air date; the steps keep
their order, show the real dates, and the pill between them shows a dash.
Nothing is ever guessed.

Above the steps, four small tiles:

| Tile | What it counts |
|---|---|
| Total aging | Days since the site went on air, to today (to the acceptance date once acceptance is done). A dash when the on-air date is not known |
| In current step | Days since the current step started |
| Longest step | The longest gap between two steps |
| Oldest pending | The longest wait among ICT or CRA sides still pending, and how many villages that authority has pending. Hidden when nothing is pending |

### Acceptance by village

Each village's ICT and CRA status. Up to six villages are shown as two panels
side by side; more than six as one table whose rows scroll under a fixed
header. **All** shows every village, **Open** only those not yet approved by
both. Villages with a rejection come first, then those with most pending,
then the longest waiting; fully approved villages are last, in the same order
for ICT and CRA.

| You see | It means | The line under it |
|---|---|---|
| Approved (green tick) | The authority approved every requested technology | The decision date, and how many days it took from the request letter |
| Rejected (red cross) | A technology was rejected and nothing has been filed since | The decision date, "not re-filed yet" |
| Pending (amber clock) | With ICT or CRA: a request letter is out | "With ICT since …, waiting n days" |
| Pending | The answer has been filed and is with the coordinator | "Answer filed …, with coordinator" |
| Pending · Returned | The coordinator sent the filing back | "Returned …, needs a new letter" |
| Pending · Re-filed | Round 2 or later is in progress | "Re-filed …, waiting n days" |
| Pending | Nothing has been filed | "Not filed yet" |

Opening a village from the header search, or from My Work's village record,
lands on its site with that village highlighted.

Before the drive test is done the section says *Acceptance starts when the
site is on air and drive-tested.*

## The Drive Test dashboard

The Drive test app's rail no longer lists Dashboard. The dashboard is in
**Insights › Dashboards**, and old links to it still work. The Drive test app
now opens on its first queue.
