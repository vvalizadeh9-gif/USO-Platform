# Design system "Cobalt"

The look of the USO Enterprise Platform (UEP). Every value here is a CSS custom
property on `:root` in `frontend/src/styles/app.css`; that file is the source
of truth and this document is its reading guide. Change a token there, then
change it here.

Cool blue-grey canvas, white cards, one cobalt accent for selection and action,
dark readable text. Inter for Latin text and figures (tabular), Vazirmatn for
Farsi.

---

## 1. Rules

These hold on every page. A page that needs to break one asks first.

1. **Status colour is an ink on its own soft fill, and always carries its
   label.** Done/Ongoing/Pending/Problem are never shown by colour alone.
2. **Cobalt (`--accent`) means selected, action, or progress.** Selection and
   the primary action, and one data meaning: work done against a whole (DT
   done, PIP delivered, a met month, submitted of assigned, the DT-done line).
   Reference and backlog data are the two data neutrals (`--dt-muted`,
   `--dt-pending-bar`). Cobalt is never a decorative icon tint.
3. **Authority colours (`--ict`, `--cra`) are for data only.** Never for status,
   never for selection. Status pills keep their own colours.
4. **ICT and CRA always appear with their label**, never as colour alone.
5. **`--cra` is never text.** It is 3.1:1 on white: graphics only. CRA words use
   `--cra-ink`. (`--ict` is dark enough to be its own ink.)
6. **Icon chips are neutral**: `--neutral-soft` fill, `--text-secondary` icon.
   The supporting teal that used to tint icons is retired (it sat too close to
   `--cra`). In the sidebar, icons are neutral too; only the selected item's
   icon is cobalt, and Month-end keeps its amber.
7. **Selection** uses the selectable-tile selected state: `--accent-wash`
   background and a 2px `--accent` border. No authority or status colour ever
   shows selection.
8. **Figures use tabular numbers** (`font-feature-settings: 'tnum'` is on for
   the whole body).
9. **Charts are hand-built** (HTML/SVG). No charting library.
10. **The browser page never scrolls.** At 1440x900 and 1280x800 the document
    neither scrolls vertically nor sideways. A one-screen page (`PageFrame`)
    fills the space under its `PageBar`; its long lists scroll inside their
    card under a sticky header, and the assignment dock stays pinned. Every
    other page scrolls inside the shell's `.page-outlet`. See ARCHITECTURE.md,
    "The frontend layout contract".
11. **Changes are ink, not colour.** "+64 vs last month" is neutral text with
    the number in bold ink. The one exception is the trend's gap pills, which
    keep green (shrank) and brick (grew) because they are a verdict, with a
    legend.
12. **Nothing is set below 12px**, and every size is a `--fs-*` token (below).
13. **Every number that counts villages is exportable.** On a page that has
    the export behind it (Lifecycle Gaps today), each village count is an
    `ExportNumber` that downloads exactly the villages it counts, and the
    file adds up to the number. Percentages are never exportable.

---

## 2. Tokens

### Surfaces

| Token | Value | Use |
|---|---|---|
| `--bg` | `#EEF2F7` | the canvas |
| `--surface` | `#FFFFFF` | cards |
| `--surface-subtle` | `#F6F8FB` | tiles and callouts inside a card |
| `--border` | `#DDE3EC` | card outlines |
| `--divider` | `#EDF1F6` | table rows, hairlines inside a card |
| `--track` | `#E4E9F1` | the unfilled part of a bar or meter; tile borders |
| `--control-border` | `#C8D1DE` | inputs and other controls |

### Text (contrast measured on `--surface`)

| Token | Value | Contrast |
|---|---|---|
| `--text` | `#141B2B` | 17.0:1 |
| `--text-secondary` | `#475569` | 7.6:1 |
| `--text-tertiary` | `#5F6B7E` | 5.4:1 (4.8:1 on `--bg`) |
| `--text-link` | `#2451C0` | 7.4:1 |
| `--text-on-accent` | `#FFFFFF` | 5.7:1 on `--accent` |

### Accent — selected and action only

| Token | Value | Use |
|---|---|---|
| `--accent` | `#2F5FD0` | selected state, primary action, focus ring |
| `--accent-ink` | `#1D3F99` | cobalt text (9.5:1) |
| `--accent-soft` | `#E3EAFB` | selected fill where a wash is too faint |
| `--accent-wash` | `#F2F6FE` | selected tile background, hover |
| `--accent-track` | `#D3DEF7` | selected outline where 2px is too heavy |

### Authorities — data only

| Token | Value | Use |
|---|---|---|
| `--ict` | `#8E2F74` | ICT data fill; also ICT text ink (7.5:1 on white) |
| `--ict-base` | `#EBD3E4` | ICT faint "base": the waffle's unfilled squares |
| `--ict-soft` | `#F5E6F1` | ICT chip background |
| `--cra` | `#23A396` | CRA data fill (3.1:1 on white — graphics only, never text) |
| `--cra-ink` | `#0F6F66` | CRA text ink (6.0:1 on white, 5.2:1 on `--cra-soft`) |
| `--cra-base` | `#C9EAE5` | CRA faint "base": the waffle's unfilled squares |
| `--cra-soft` | `#DDF3F0` | CRA chip background |

The ICT/CRA pair was checked with a colour-vision validator: it passes against
each other and against `--accent`. It sits just under the comfort line against
the Ongoing/Problem/Done status colours, which is acceptable only because of
rules 3 and 4.

First used on **Performance → Lifecycle Gaps**, and on **Acceptance →
Dashboard**. Other pages move to these tokens one page per change.

| Token | Value | Use |
|---|---|---|
| `--accent-base` | `#D3DEF7` | cobalt's faint "base", for a cobalt data series (the Village stream's target bar) |

#### A page with one data series per tab: `--acc-series*`

The Acceptance Dashboard draws the same components for three streams. The
page sets three custom properties once, on `.acc-page`, from the active tab
(`.acc-stream-ict`, `.acc-stream-cra`), and every component reads them; no
component chooses a colour itself.

| Property | Village | ICT | CRA |
|---|---|---|---|
| `--acc-series` | `--accent` | `--ict` | `--cra` |
| `--acc-series-base` | `--accent-base` | `--ict-base` | `--cra-base` |
| `--acc-series-ink` | `--text-link` | `--ict` | `--cra-ink` |

A page with the same shape of data can copy the pattern: one property
block per tab, components that only read it.

### Status — an ink on its own soft fill, always with a label

| Status | Ink | Soft |
|---|---|---|
| Done / success | `--success-ink` `#1D7A4B` | `--success-soft` `#E2F3E9` |
| Ongoing | `--ongoing-ink` `#6A45C2` | `--ongoing-soft` `#EEE8FB` |
| Pending | `--pending-ink` `#8A5600` | `--pending-soft` `#FCF0D9` |
| Problem / danger | `--danger-ink` `#B42F2A` | `--danger-soft` `#FBE6E4` |
| Neutral / not started | `--neutral-ink` `#5F6B7E` | `--neutral-soft` `#EDF1F6` |

Every ink clears 4.5:1 on white and on its soft fill. Done and Problem are only
11.4 apart (CIEDE2000) for a deuteranope — which is why every status keeps its
text label and every chart keeps its legend.

### Data neutrals

| Token | Value | Use |
|---|---|---|
| `--dt-muted` | `#8391A7` | reference data: the on-air series and sparkline, opening balances, open work on a contractor tile, "not started" (3.19:1 — graphics only) |
| `--dt-pending-bar` | `#6B788D` | backlog data: the pending share, arrivals, a month below its PIP, folded rows |

Progress data is `--accent`; an ink `--text` tick marks "expected by today"
on any progress bar and the PIP on a month's bar.

### Banners

Info, warning, error and success each have `-bg`, `-border`, `-text` and
`-icon` tokens (`--banner-warning-bg` etc.). A banner always says its message
in words; the tone only colours it.

### Type

Every size is a token pair on `:root`; inline font sizes use the token
(`fontSize: 'var(--fs-meta)'`), never a number.

| Role | Tokens | Size / line | Weight |
|---|---|---|---|
| Display (page title) | `--fs-display` / `--lh-display` | 28 / 36 | 600 |
| Figure (a headline number) | `--fs-figure` / `--lh-figure` | 30 / 38 | 600, tabular |
| Card heading | `--fs-heading` / `--lh-heading` | 17 / 24 | 600 |
| KPI / tile title | `--fs-title` / `--lh-title` | 15 / 22 | 600 |
| Body, Farsi data | `--fs-body` / `--lh-body` | 15 / 22 | 400 |
| Table cell, tab, button | `--fs-control` / `--lh-control` | 14 / 20 | 400–600 |
| Meta, legend, eyebrow | `--fs-meta` / `--lh-meta` | 13 / 18 | 600 for eyebrows |
| Table header, count, pill | `--fs-caption` / `--lh-caption` | 12 / 16 | 600 |

Nothing is smaller than 12px and nothing is uppercase. Inter for Latin and
figures, Vazirmatn for Farsi (`--font-farsi`). Farsi names in data are 15px
Vazirmatn (`.text-farsi`), `dir="rtl"` or `dir="auto"`.

### Shape and depth

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 6px | buttons, inputs |
| `--radius-md` | 8px | tiles, banners |
| `--radius` | 10px | cards, dialogs |
| `--shadow-1` | faint | cards (with a 1px `--border`) |
| `--shadow-2` | raised | menus, dialogs, drawers |

---

## 3. Components (in `frontend/src/components/ui.jsx`)

- **PageBar** — the header of a one-screen page (with `PageFrame`), 131px:
  row 1 (min 60px) the eyebrow (13/18 600, `--text-link`) over the title
  (28/36), then a `context` slot after a 1px divider (the process stepper, or
  the dashboard's province scope), then `actions` pushed right; row 2 (50px)
  the `tabs` and, at the far end, `tabsRight` (controls that act on the
  tab's view). Padding 20 32 0 on `--bg`, 1px `--border` below. The eyebrow
  is the sidebar section ("Drive Test").
- **PageHead** — the scrolling pages' header: eyebrow, title, optional
  subtitle, actions on the right.
- **ProcessStepper** — 1 › 2 › 3 (Monthly Plan › Health Check › Drive Test) in
  a PageBar's context slot. The current step is `--accent-wash` with a filled
  accent number and `aria-current="step"`; the others are links when the
  person can open them. Under 1360px the other steps show their numbers only.
- **Tabs** — real `role="tab"`; arrow keys move and select. 38px high in a
  PageBar, the selected one heavier with a 20x3 accent bar. A tab may carry
  an icon, a count chip (neutral; `--accent-soft`/`--accent-ink` on the
  selected tab) and a second chip in `--danger-soft`/`--danger-ink` ("4
  late"). `steps` puts a chevron between the parts of a process; a `group`
  draws tabs that are one thing (the fix loop) in a labelled
  `--neutral-soft` container; an `end` tab (History) sits at the far end
  behind a divider.
- **KpiCard** — one card of a KPI band: 20px padding, a neutral 36px icon chip
  and a 15/22 title (a badge, e.g. an "Internal" pill, at the end of the
  row), the 30/38 figure with a note or the neutral delta at the end of its
  line, and the card's floor for a bar or sparkline. A region named by its
  title. Bands are 12px apart.
- **Meter** — an 8px share on the track: `--accent` fill, an optional 2px
  `--text` tick at expected-by-today.
- **SegmentedControl** — one choice out of a few; every option is a button with
  `aria-pressed`.
- **Card** — white, radius 10, padding 20/24; optional header with a neutral
  36px icon chip, heading, description and actions.
- **Banner** — info / warning / error / success.
- **EmptyState** — the "nothing to show" and error state, with the server's
  message.
- **Selectable tile** — `--surface-subtle`, 1px `--track`, radius 8, padding 16.
  Selected: `--accent-wash` fill and a 2px `--accent` border.
- **AssignDock** (`components/AssignDock.jsx`) — the assignment dock on HC
  Pool and DT Assignment, pinned to the bottom of the main column (never
  inside the table, never over it). Top row: the accent count badge and "N
  sites selected", Clear (ghost), a hint, and the primary button naming the
  pick ("Assign health check to پیشرو فن"), disabled until there is both a
  site and a contractor. Under it, one row of contractor tiles as a
  `role="radiogroup"` of buttons: radius 10, 1px `--border`, `--shadow-2` on
  hover; a 40px neutral initial avatar; the Farsi name 15/600 with an
  ellipsis; a 4px load meter (open work in `--dt-muted`, the late share in
  `--danger-ink` on health checks); a 12px line ("14 open · 2 late", "16 in
  progress"). Selected: 2px accent border, accent-wash fill, filled accent
  avatar, accent-ink name, accent meter, and a 22px accent check badge at the
  top right. Arrow keys move the choice; the focus ring is visible.
- **Queue card** — a fill-height `Card` (`.card-fill.queue-card`): chip,
  title (with a neutral `.count-chip`), a one-line instruction, and the
  filters (search, province, a segmented state filter with counts) in its
  head; the table in `.table-scroll`; a foot row ("200 of 1,012 loaded",
  Load 200 more). Ticked rows are `--accent-wash`.
- **AuthorityChip** — ICT or CRA in words: a 24px pill, `--ict-soft` with
  `--ict` ink, or `--cra-soft` with `--cra-ink`. Every authority figure carries
  one (rule 4).

### Acceptance Dashboard components (`frontend/src/pages/reports/acceptance/`)

- **Target-vs-actual bars** (`ProgressChart.jsx`, Monthly) -- one column per
  month: the plan a pale bar behind (`--acc-series-base` at 55%, radius 6),
  what was done a solid bar in front, same width (`--acc-series`), its value
  inside at the base in white 12/600; a second plan as a 2px `--text` tick
  across the bar, 5px past each side; the running month in 45° stripes with
  its value above in `--acc-series-ink`. Under each Farsi month name
  (Vazirmatn 12) an attainment pill: done ÷ plan as a whole %, success ink at
  100% or more, danger below, "so far" (neutral) on the running month; no
  plan, no pale bar and no pill. Four quiet gridlines, 12px tertiary labels.
  Cumulative mode is a 3px monotone-cubic area (28% → 2% fill), plans dashed
  (`--text`, 1.5, `6 5`) and dotted (`--dt-muted`, 2, `1.5 4`), end labels
  nudged 15px apart and one gap callout. Every month is a transparent button
  behind the drawing (`aria-pressed`); the selected one is an 8% accent wash.
  The drawing is sized by a `ResizeObserver`, never fixed pixels.
- **Plan ring** (`PlanRing.jsx`) -- 128px, stroke 11 on `--track`; the arc in
  `--acc-series` with round caps from 12 o'clock, capped at a full circle;
  in the running month a 2.5px ink tick at due-by-today. Centre: the done
  count 28/34 600 over "of {plan}" 14/20. Under it the plan's name with its
  line swatch, "**N%** delivered" (the true %, may pass 100) and a pace pill
  ("+17 vs due today", "−20 vs plan", "On pace"). No plan: a neutral "No plan
  set" ring and no pill.

### My Work components (`frontend/src/pages/mywork/`)

Every element that shows a status takes `data-tone` (pending, ongoing,
success, danger, neutral), which sets `--tone-ink` and `--tone-soft` for it;
no component picks a status colour itself. ICT and CRA colours appear only in
`AuthorityChip`s.

- **Status bar** (`StatusBar.jsx`) -- the three-segment traffic light for one
  side: submitter ("You fill" / "Contractor"), checker ("Coordinator" / "You
  check"), "Approved". Segments 8px, radius 4, 4px apart, each labelled 12/16;
  the lit one is the status ink (600 label), the others their own soft tint
  (pending, ongoing, success). Returned is the lit segment drawn as a 1.5px
  `--danger-ink` outline on white; Rejected is solid. Segment 1 is renamed to
  the trouble when the side came back ("Returned", "Rejected"). `role="img"`
  with "Status: …". The **mini bar** in a list row is three 18 × 6 segments
  over the status word (12/16 600 in its ink), 62px wide. A legend under the
  list names each colour.
- **Village row** -- 60px: a checkbox, the Farsi name (Vazirmatn 15/22 500,
  ellipsis), an optional "Round N" neutral tag, and a 13/18 meta line (code,
  the contractor for staff, then the days waiting, which turn `--pending-ink`
  600 at 60 days or more and never truncate), then a mini bar per authority.
  Focused: `--accent-wash` with a 2px inset `--accent` border; ticked:
  `--accent-wash`.
- **Outlined field** -- the letter number and date: 44px, radius 6, the
  12/16 600 label sitting on the top border (white behind it). Invalid is a
  `--danger-ink` border and label, and the field's own text says what is
  wrong ("Missing", "Scan missing", "Reason missing") -- there is no helper
  text under any field.
- **Letter numbers and Shamsi dates** (`.mw-fa-ltr`, `.mw-digits`) -- Persian
  digits in Vazirmatn, `direction: ltr; unicode-bidi: isolate-override`:
  isolated from the sentence around them, *and* kept in typed order inside,
  because a Persian letter in "۱۴۰۵/ص/۱۹۲۰" would otherwise reorder it.
- **Review block** -- the filed letter on `--surface-subtle` (radius 8): the
  letter number and date, who filed it, "View scan", then one pill per
  technology ("2G approved" success, "4G rejected" danger) with its reason.
  Actions: "Confirm all N on this letter" on its own full-width row when the
  letter covers others, then Return (danger text) and Confirm (primary).
- **History line** -- one per round, newest first, two visible and "Show all
  N": a 20px tone mark (✓, ×, a returned ↩ outlined, • filed), R{n}, the
  letter number, the short result in its tone, the date. The full text is the
  line's hover title. In a card narrower than 300px (1280px screens) the date
  drops from the line and stays in the title.
- **Undo toast** -- the one `--shadow-2` on the page: success banner colours,
  radius 8, pinned to the bottom of the work column, "Sent ICT for سرآسیاب"
  with Undo and ×. Slides in 8px over 180ms; no motion under
  `prefers-reduced-motion`.

### Lifecycle Gaps components (`frontend/src/components/`)

Built for Lifecycle Gaps and free of it; any page with the same shape of data
can use them.

- **Waffle** (`Waffle.jsx`) — squares of a whole, `aria-hidden` (the figure
  beside it carries the number): `filled` of `total` in `--ict`/`--cra`, the
  rest in `--ict-base`/`--cra-base`; a dotted empty grid for "no data yet".
  Three sizes: `tile` (10 × 10, fills its width, max 220px, 180px under
  1300px, gap 4), `hero` (7px squares) and `mark` (a 20-square strip, 5px,
  one square per 5% of a whole).
- **WaffleTile** (`WaffleTile.jsx`) — one gap as a selectable tile:
  `--surface-subtle`, 1px `--track`, radius 8, padding 16, `--shadow-2` on
  hover; selected is `--accent-wash` with a 2px `--accent` border. The chip and
  a 15/22 label; the 10 × 10 waffle, `round(100 × gap ÷ base)` squares filled
  (100 squares = that tile's own base); the 30/38 figure in `--ict` or
  `--cra-ink`; and only the share, "**13%**" (13/18), or "—" over a base of
  0 with "Nothing counted yet" under it (12/16 `--text-tertiary`). What the
  share is a share of ("13% of 4,433 drive-tested") is in the tile's
  accessible name, not on screen.
  **Two targets, never nested**: the tile is a stretched `<button>` under
  everything (it opens), the figure is its own button above it (it exports);
  everything else lets clicks through.
- **GapDrawer** (`GapDrawer.jsx`) — the right-side drawer pattern: a modal
  dialog (`role="dialog"`, `aria-modal`) 620px wide (full width on phones),
  `--surface`, `--shadow-2`, radius 10 on its left corners, over the shared
  `.scrim`, portalled to the body and fixed, so **the page behind never moves
  or reflows**. Focus goes to Close on open, stays inside, and returns to the
  opener; Esc, ✕ and the scrim close it. Header: eyebrow (13/18 600
  `--text-link`), the chip and a 17/24 title, the close button. A subtle hero
  tile (7px waffle, the figure, its share); a `SegmentedControl` "Group by" on
  one line (hidden when there is only one's own row to show); a summary line;
  the list, which alone scrolls, with a sticky 12/16 header (mark · name ·
  pending · share of gap) and every row listed; a footer with what the share
  means and the checksum ("Adds up to 1,391 ✓", or a `--danger-soft` warning
  with no tick). An `EmptyState` replaces the list when there is nothing to
  list yet.
- **ExportNumber** (`ExportNumber.jsx`) — a village count that downloads its
  villages (rule 13). At rest the number with a 2px dotted `--control-border`
  underline; on hover and focus `--accent-soft`, a solid underline and a 14px
  download icon that sits just past the number (it takes no room at rest, so
  nothing moves). Label and tooltip: "Export 205 villages (CRA pending ·
  Coordinator V. Hashemi) to Excel". While the file is built it spins and is
  disabled. The result is a Cobalt `Banner` — success ("Exported 205
  villages") or error (the server's reason) — in `ExportFeedback`'s fixed
  corner, so a download never scrolls or re-lays out the page. A zero is drawn
  as a plain number.
