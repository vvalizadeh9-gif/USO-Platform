# Explorer

*For everyone who works on drive tests: PM, coordinators, contractors,
regional managers and viewers. Open it from the Drive test app's rail.*

Explorer is every site you can see, and one page per site that tells its
whole story: what the site is, where it is in UEP, how long each step took,
and where each of its villages stands with ICT and CRA.

Every date on Explorer is Gregorian, for example **6 Oct 2026**. The rest of
UEP still shows Shamsi dates.

## The list

The list is the one All sites used to be, under a new name. The stage chips,
the province and contractor filters, paging and **Export** work as before.

- **Search** finds a site by its site ID, its province, or any of its villages
  by village ID or village name.
- **Villages** is the number of the site's هدف villages.
- **Click a row** (or its site ID) to open the site's record. On *Ready for
  assignment* and *Returned* a click selects the row for bulk assignment, as
  before; the site ID still opens the record.

Old links to `/work-items` still work and land here.

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
progress*. Between two steps a pill shows how many days the step took
("+7 d"), and on the current step how long it has been going ("+8 d so far").

Sites imported from CPM before Mehr 1405 may have no dates for early steps.
Those steps read *No date*, and any number that needs the date shows a dash.
Nothing is ever guessed.

Above the steps, four small tiles:

| Tile | What it counts |
|---|---|
| Total aging | Days from the first dated step to today (to the acceptance date once acceptance is done) |
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
