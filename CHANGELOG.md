# Changelog

## Erase CPM data after a Mojri import; the Mojri card compares every approved village

**Admin → Erase all CPM data** failed ("Erase failed") on any database that had
ever had a Mojri tracker import: `mojri_tracker_status` references `villages`
and was never deleted, so the village delete failed its foreign-key check and
the whole wipe rolled back. The wipe now also erases Mojri tracker statuses and
import runs (and drive-test evidence, explicitly). Every wiped table is listed
once in `data_wipe.WIPE_ORDER`, and a test walks the schema so a new table
that references CPM data can no longer be forgotten.

**Lifecycle Gaps → ICT vs CRA vs Mojri tracker** now compares **every** village
ICT or CRA approved (CPM and in-app, on air or not, drive test done or not)
with Mojri's tracker. It used to count on-air, drive-tested villages only,
while the Mojri template lists every approved village, so approved villages
off air were in the uploaded file but never counted on the page. The template
and the card now share one definition, and a test holds them equal. The
template now lists هدف villages only, like every other report. Cards 1 and 2
are unchanged. The Mojri import still never writes acceptance data.

## Acceptance Dashboard redesign; ICT and CRA plan streams

**Acceptance → Dashboard** is rebuilt around one question per card: *am I on
plan month by month, and what happened in a given month?* It now has one tab
per stream (Village = fully accepted, ICT, CRA), each with a KPI band, a
progress chart against the **Internal PIP** and the **Contractor PIP** (Monthly
bars or Cumulative lines), and a month panel with the two plans as rings.
It is one screen at 1440×900, and a new read, `GET /acceptance/progress`,
feeds the chart and the panel for all three streams at once.

**Monthly Plan** gains two plan streams, **ICT** and **CRA**, beside DT and
Acceptance: the PM sets an Internal PIP for each, and contractors file, and
revise, an ICT and a CRA PIP through the same flow. "MTN internal target" is
now called **Internal PIP** everywhere on screen.

### Removed, and why

One question per card; per-owner and per-contractor detail lives in Roles
Performance, not here. So the dashboard no longer has:

- the approval-flow Sankey;
- the monthly velocity chart;
- the ICT and CRA mini approval charts;
- the ICT vs CRA comparison;
- the remaining-split strip, and any breakdown of Village *Remaining*;
- the per-chart contractor filter (the page-wide scope picker replaces it);
- the on-air permanent / temporary split;
- "Not tested yet", and "ICT and CRA both approved, +N this month".

`GET /acceptance/trends`, which only the old charts read, is kept but marked
deprecated.
