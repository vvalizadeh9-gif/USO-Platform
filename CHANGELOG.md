# Changelog

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
