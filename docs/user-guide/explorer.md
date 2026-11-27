# Explorer

*For everyone who works on drive tests and acceptance: PM, coordinators,
contractors, regional managers and viewers.*

Explorer is every site you can see, and one page per site that tells its
whole story: where the site is, which villages it serves, where it stands in
its journey and how long each step took, and where each village stands with
ICT and CRA.

Every date on Explorer is Gregorian, for example **6 Oct 2026**. The rest of
UEP still shows Shamsi dates.

## The list

Explorer opens on the list of every site you can see. Its job is to find one
site fast and open its record. The pill beside the title counts them
(**4,201 sites**); while you search or filter it reads **97 of 4,201 sites**.

- **Search** (*Find a site by ID, village ID, village name or province*)
  narrows the list as you type. Persian names match however the letters were
  typed, and the matching text is highlighted. Press **/** anywhere on the page
  to jump to the search; **Esc** or **×** clears it.
- **When the search finds a village**, the village shows on its own line under
  its site: its name and ID, **+n** when more of the site's villages matched,
  and **Open record**, which opens the site with that village highlighted.
- **Filters** are the pills beside the search: Province, Site type,
  Technology and DT contractor. Click a pill, then a value (Province has its
  own search box). A chosen pill turns blue and shows its value; **×** removes
  it and **Clear filters** removes them all.
- **Sort** by clicking a column header; click it again to reverse. The list
  starts sorted by site ID.
- Search, filters and sort are in the page address, so you can share a view
  by sharing its link. **Export** downloads exactly what the list shows.

Each row shows the site ID with its type (**New** or **Add tech**), the
province, the number of target villages, the requested technologies, the DT
contractor (*Not assigned* when there is none) and the **Stage**:

- a small bar: the steps done out of six, and the open step striped;
- the open step: *Health check*, *Assignment*, *Drive test*, *Sent to ICT* or
  *Acceptance*, then how many days the site has been in it;
- the days turn **red with a warning mark** only when the site is over that
  step's time limit (set in Admin › SLA policies);
- **Accepted** with a green check once every village is approved by ICT and
  CRA.

Sorting by Stage lists sites in journey order, and inside each step the one
waiting longest first.

- **Click anywhere on a row** to open the site's record. The checkbox and the
  villages pill do not open it.
- **The villages pill** shows the site's target villages under the row.
- **↑ ↓** move between rows, **Enter** opens one (the search box's tooltip
  reminds you).
- **Tick rows** to export them or copy their IDs from the bar that appears.
- Coming back from a record returns you to the same place in the list.

## A site's record

One screen, top to bottom: the site ID with its status, the site passport, and
the journey.

### The status

Beside the site ID, one badge says which step the site is in: *Health check in
progress*, *Awaiting assignment*, *Drive test in progress*, *Awaiting
submission to ICT*, *Acceptance in progress*, or **Acceptance done** in green.
It is always the step the timeline shows in progress. On the right: **Take
action** (when you have something to do on this site), **Open in My Work**,
and **File letter** for the roles that file.

### The site passport

- **Province:** a small map of Iran with the site's province filled in and
  pinned, and its name.
- **Target villages:** the villages as chips, name and ID. Click a chip to
  highlight that village in the table below; click it again to clear it.
  **+n more** and **History** open the village history.
- **Site type** and **Requested technology** (2G, 3G, 4G with signal bars).
- **Contractors:** the site contractor and the DT contractor.

### The journey

At the top right, two numbers:

- **Total aging:** days since the health check was done (until acceptance
  was done, for a finished site). Before the health check it reads "—".
- **Oldest pending:** how long the longest-waiting ICT or CRA side has waited,
  and how many villages that authority still has pending. Hidden when nothing
  is pending.

The **timeline** draws the site's steps to scale: a long step looks long.
Above the line, the days each step took ("8 d", or "16 d so far" for the open
one); below it, each step and its date, with **On air** and **DT done** in
bold blue. A dashed line marks **Today**. Once the drive test is done the line
splits in two: the **ICT** lane (plum) and the **CRA** lane (blue), each
filling as villages are approved and ending in "**2** of 3 approved", or "All
approved" with the date. *Sent to ICT* sits on the ICT lane. Steps still to
come are a dashed grey tail. A step CPM imported without a date shows "—".

**Sent to ICT in batch #n** beside the title opens that Submissions batch.

### Acceptance by village

One table for every site: each village, then its ICT and its CRA status. The
column heads count approved, pending and rejected. Each status is a word with
its mark and a date: "15 Nov 2026" (approved), "13 Nov 2026, not re-filed
yet" (rejected), "Re-filed 17 Nov 2026", "Filed 20 Nov 2026" or "Not filed
yet". Rejected villages come first, then pending, then approved. **Open**
shows only villages not yet approved by both. Before the drive test is done
the table says *Acceptance starts when drive test is done.*

### Village history

**History** opens a panel with the site's current villages and every village
a monthly CPM import added or removed, newest first, and what the PM decided:
"Applied by … on …", or "Ignored by … on … · still on this site". **Export to
Excel** downloads the current villages and the history as two sheets (if you
have the Export feature). Villages removed before this release show their ID
only. **Esc** closes the panel.

### When something is missing

A site you may not see shows the no-access screen; a site that does not exist
says it was not found. If a part of the page cannot load, it says so with
**Retry**.
