# UEP design foundation

The look every new UEP page is built on, starting with Sign-in. The values live
in `frontend/src/styles/uep-tokens.css` (the source of truth) and are mirrored
for script in `frontend/src/design/tokens.js`; `tokens.test.js` fails if the
two disagree. Change a token there, then here.

Since UEP-13 this is the **only** design system: every page is on it. The
older "Cobalt" system (its `:root` block in `app.css`, Inter, Lucide icons and
`design-system-cobalt.md`) is retired. Tokens the Cobalt pages needed that UEP
had no name for were moved into `uep-tokens.css` under "Migrated from the
retired Cobalt block".

**Guardrails.** `npm run lint` runs ESLint (no `lucide-react` import, no hex
colour literal and no `'NNpx'` inline style in components) and stylelint
(`.stylelintrc.json`: no hex outside `uep-tokens.css`; `border-radius` and
`font-family` take tokens or `inherit` only). Radii are 4 / 8 / 12 / 999
(`--uep-radius-sm`, `-tile`/`-control`, `-card`, `-pill`); type sizes are the
`--uep-fs-*` steps. `e2e/designSystem.spec.js` checks every page's computed
fonts, colours and icons and keeps a screenshot baseline per page.

**No hard-coded colours or sizes in components.** Every value is a `--uep-*`
token. **Nothing is fetched from the internet at run time**: fonts and icons are
bundled from `node_modules` and served by UEP itself.

---

## 1. Rules

1. **Two blues.** Bright cobalt (`--uep-accent`) means *click me*: primary
   buttons, links, the active rail item, the focus ring, the logo tile. Deep
   cobalt (`--uep-brand-deep`) means *this is UEP*, and is for large brand
   surfaces only (the sign-in panel, a future splash or email header), never
   buttons or small elements. Never fill a large area with bright cobalt.
2. **Green is for Approved only.** `--uep-approved` marks the Approved status
   and nothing else.
3. **Nothing lighter than `--uep-text-3`.** Text has to stay comfortable for
   years of daily use.
4. **Flat by default.** Shadows only on popovers and menus, and on card hover.
5. **Carbon icons only**, through the `Icon` component.
6. **Motion is optional.** Every non-essential animation stops under reduced
   motion.

## 2. Colour

| Token | Value | Use |
|---|---|---|
| `--uep-accent` | `#1D4ED8` | The only "click me" colour |
| `--uep-accent-hover` | `#1E40AF` | Primary button hover |
| `--uep-accent-tint` | `#E8EEFC` | Selected/active backgrounds, avatar |
| `--uep-accent-on-tint` | `#DCE6FD` | Secondary text on accent fills |
| `--uep-brand-deep` | `#0F1F4B` | Large brand surfaces only |
| `--uep-brand-wave` | `#93B2FF` | Decorative wave lines on brand-deep |
| `--uep-on-accent`, `--uep-on-brand` | `#FFFFFF` | Text on those fills |
| `--uep-text` | `#14171F` | Primary text |
| `--uep-text-2` | `#3B4250` | Secondary text |
| `--uep-text-3` | `#4B5260` | Captions, metadata (the lightest allowed) |
| `--uep-page` | `#F5F6F8` | Page background |
| `--uep-surface` | `#FFFFFF` | Cards, panels, header |
| `--uep-border` | `#E3E6EC` | Default 1px borders |
| `--uep-border-strong` | `#C9CFD9` | Inputs, secondary buttons, hover borders |
| `--uep-divider` | `#EEF0F3` | Row dividers, neutral pills |
| `--uep-danger` / `--uep-danger-tint` | `#B42318` / `#FDECEC` | Errors, late; Rejected pill |
| `--uep-approved` / `--uep-approved-tint` | `#146C2E` / `#E7F5EC` | **Approved only** |
| `--uep-filed` / `--uep-filed-tint` | `#5B21B6` / `#F1ECFB` | Filed / submitted |

App identity (tiles: white icon on the colour; tint for card headers):

| App | Tile token | Tile | Header tint |
|---|---|---|---|
| Drive test | `--uep-app-drive-test` | `#0F766E` | `#EDF6F5` |
| Acceptance | `--uep-app-acceptance` | `#6D28D9` | `#F3EFFC` |
| Monthly plan | `--uep-app-monthly-plan` | `#B45309` | `#FBF3EA` |
| Insights | `--uep-app-insights` | `#0369A1` | — |
| Data | `--uep-app-data` | `#475569` | — |
| Admin | `--uep-app-admin` | `#57534E` | — |
| Home (launcher only) | `--uep-app-home` | `#14171F` | — |

## 3. Typography

- **IBM Plex Sans** 400/500/600 for the whole UI (`--uep-font-sans`, falling
  back to Segoe UI). SIL OFL, from `@fontsource/ibm-plex-sans`.
- **Vazirmatn** 400/500/600 for Persian data only: Shamsi dates (Persian
  digits) and village names (`--uep-font-persian`). Already self-hosted in
  `styles/fonts.css`.
- Scale (`--uep-fs-*`): 12 caption · 13 small · **14 body** · 15 · 16 card
  title · 18 section · 24 page title · 26 greeting · 28 sign-in title · 32 KPI
  · 64 brand statement.
- Line height `--uep-lh-ui` 1.45. Headings of 22px and up track tighter:
  `--uep-tracking-heading` −0.02em, `--uep-tracking-brand` −0.03em.

## 4. Shape, spacing, elevation, focus

- Radius: `--uep-radius-control` 6 (inputs, buttons) · `--uep-radius-tile` 8
  (tiles, rail items, KPI tiles) · `--uep-radius-card` 12 · `--uep-radius-pill`
  999.
- Spacing (`--uep-space-N`, N in px): 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48
  · 56 · 64.
- Popovers and menus: `--uep-shadow-popover`. Card hover: border to
  `--uep-border-strong` plus `--uep-shadow-card-hover`.
- Focus: inputs get an `--uep-accent` border plus `--uep-focus-ring`; buttons
  and links get a 2px accent outline at 2px offset.

## 5. Icons: IBM Carbon only

`<Icon name="user" size={18} />` (`frontend/src/components/Icon.jsx`) draws a
Carbon glyph (`@carbon/icons`, Apache 2.0) in `currentColor`, so CSS recolours
it with `color`. It is hidden from assistive technology unless given a
`label`. Sizes: 16, 18 or 20 inline; 20–22 inside tiles. Carbon's 16px glyph is
used up to 16px, its 20px glyph above.

| Purpose | Carbon icon |
|---|---|
| Home | `home` |
| Drive test | `cell-tower` |
| Acceptance | `certificate--check` |
| Monthly plan | `calendar` |
| Insights | `chart--column` |
| Data | `data--base` |
| Admin | `settings` |
| App launcher | `switcher` |
| Search | `search` |
| Notifications | `notification` |
| Dropdown | `chevron--down` |
| Row arrow | `chevron--right` |
| Back | `arrow--left` |
| Username | `user` |
| Password | `password` |
| Sign in | `login` |
| Show / hide password | `view` / `view--off` |
| New security question | `renew` |
| Caps Lock warning | `warning--alt` |
| On air / tower (Explorer) | `cell-tower` |
| Drive test date, DT done step | `car` |
| Site contractor | `tools` |
| DT contractor | `portfolio` |
| Requested technology, health check step | `connection-signal` |
| Province | `location` |
| Hadaf villages | `building` |
| Assigned step | `task--complete` |
| Acceptance step | `certificate--check` |
| Aging: total, current step, longest, oldest pending | `time`, `hourglass`, `meter`, `pending` |
| Status mark: approved, pending, rejected | `checkmark`, `time`, `close` |

Add an icon by importing its two glyphs in `components/icons.js`.

## 6. Motion (IBM Carbon motion)

| Token | Value | For |
|---|---|---|
| `--uep-dur-fast` | 150ms | Hover, focus, press |
| `--uep-dur-pop` | 160ms | Menus, launcher |
| `--uep-dur-enter` | 320ms | Page entry |
| `--uep-dur-slow` | 900ms | Sparkline draw, progress fill, brand reveal |
| `--uep-ease-productive` | `cubic-bezier(0.2, 0, 0.38, 0.9)` | |
| `--uep-ease-entrance` | `cubic-bezier(0, 0, 0.3, 1)` | |
| `--uep-ease-expressive` | `cubic-bezier(0.16, 1, 0.3, 1)` | |

- Page entry: fade up 8px over 320ms.
- Press: buttons scale to 0.98.
- Hover and focus: 150ms.
- Menus and launcher: scale from 0.98 plus fade, 160ms, origin at the anchor
  corner.
- Animate `transform` and `opacity` only.

**Lists and cards rising in (UEP-11a).** On Explorer, list rows rise 6px
and fade in over 360ms (`--uep-ease-grow`), 24ms apart, on the first load and
after a new search, filter or sort; only the first 20 rows, and rows that
arrive by scrolling appear without it. The record page's cards do the same,
Journey 60ms after General information. Popovers and chips fade and slide 4px
in 160ms; an opening strip takes 200ms, a bulk bar 220ms. No count-ups, no
pulsing.

**Full-height pages: one scroll region (UEP-11a Part A).** In a column that
fills the height under the shell, every fixed row (title row, tool bar, header
row, footer) is `flex: none`, and the single region that scrolls is
`flex: 1 1 auto; min-height: 0; overflow: auto`. `styles/work.css` applies it
to every `.uw-page` and `.uw-card`. A row that only scrolls sideways is still
a fixed row: left at `flex-shrink: 1` it collapses to its scrollbar.

**Exits are faster than entrances (UEP-12).** Something leaving takes about
half the time it took to arrive and accelerates out (`--uep-ease-exit`,
`cubic-bezier(0.3, 0, 1, 1)`); entrances decelerate (`--uep-ease-standard`).
A panel that animates out stays mounted until it has gone, `inert` and
`aria-hidden`.

| Token | Value | For |
|---|---|---|
| `--uep-header-search-width` / `-open` | 480px / 640px | The header search at rest / focused |
| `--uep-header-search-height` | 36px | Its height (`--uep-search-height`, 34px, stays the launcher's filter) |
| `--uep-search-fill` / `-fill-hover` | `--uep-divider` / `#E6E9EE` | The filled field |
| `--uep-search-radius` | 8px | The field |
| `--uep-shadow-search` | `0 16px 40px rgba(20,23,31,.12), 0 2px 6px rgba(20,23,31,.06)` | The results panel |
| `--uep-surface-sunken` | `#FAFBFC` | The panel's footer |
| `--uep-dur-search-move` | 240ms | Width change, panel enter |
| `--uep-dur-search-fade` | 160ms | Colour changes, hint swap |
| `--uep-dur-search-exit` | 120ms | Panel exit |
| `--uep-dur-search-hi` | 120ms | Active-row highlight slide |
| `--uep-ease-exit` | `cubic-bezier(0.3, 0, 1, 1)` | Exits only |

`--uep-search-max` was removed. Search tiles reuse the app hues; the Insights
tile tint is `--uep-search-tile-insights`, an alias of `--uep-cra-soft` (the
same blue), not a new colour.

**Reduced motion.** `lib/motionPreference.js` writes
`<html data-uep-motion="reduce|full">` from the system's
`prefers-reduced-motion`, and stylesheets key off that attribute. **Review
flag:** add `?motion=reduce` (or `?motion=full`) to any URL to force a mode;
it is remembered in that browser until `?motion=system`.

## 7. Sign-in

Two equal halves (`flex: 1 1 520px`). The form is on white, with the logo at the
top, a 380px column centred vertically, and the legal footer with `UEP
{version}`. The brand half is deep cobalt and holds only *USO / Enterprise /
Platform* (64px) and a 72×3 white rule. Four 1600px wave rings, centred on its
bottom-right corner, cycle every 16s, 4s apart. Below 960px the brand half is
hidden. Component tokens are `--uep-signin-*`.

The page keeps four things the approved design leaves out, by decision on
2026-10-11: the security check after two failures, "Remember my username",
the Caps Lock warning, and a skip link (visible only on keyboard focus).
"Forgot password?", "Contact your UEP administrator", Privacy, Terms and
Help go to placeholder pages for now.

> **Contrast note.** `--uep-border-strong` (#C9CFD9) is about 1.5:1 on white,
> below the 3:1 that WCAG 1.4.11 asks of an input's boundary. The inputs are
> still identifiable by their labels and icons, but if an audit flags it, the
> fix is a darker input border token.

## 8. App shell and Home (UEP-02)

Navigation model and registry: [design/navigation.md](design/navigation.md).
Home and `GET /me/home`: [design/uep-home.md](design/uep-home.md).

| Component | File | Key tokens |
|---|---|---|
| Header | `shell/AppHeader.jsx` | `--uep-header-height` |
| Header search | `shell/GlobalSearch.jsx` | `--uep-header-search-*`, `--uep-search-*`, `--uep-dur-search-*`, `--uep-ease-exit`, `--uep-shadow-search` |
| App launcher | `shell/AppLauncher.jsx` | `--uep-launcher-width`, `--uep-backdrop`, `--uep-dur-pop` |
| Account menu | `shell/AccountPopover.jsx` | `--uep-account-width`, `--uep-dur-pop` |
| App rail | `shell/AppRail.jsx` | `--uep-rail-width`, `--uep-accent-tint` (active) |
| App tile | `shell/AppTile.jsx` | `--uep-app-*` |

- The launcher and account menu pop from their corner in 160ms, close on Esc
  or a backdrop click, trap focus while open and return it to the opener.
  Arrow keys move between launcher tiles.
- Home: page enter 320ms; KPI tiles stagger 60ms; sparklines draw in 900ms
  after 250ms, the area fading in after the line; the PIP bar fills in 800ms;
  card hover 200ms; press scales to 0.98. All of it stops under
  `prefers-reduced-motion` or `html[data-uep-motion='reduce']`.
- KPI deltas are `--uep-danger` only when the change is bad, otherwise
  `--uep-text-3`. Never green.

## Card headers inside one app (UEP-04)

When every card on a page belongs to the same app, such as the Drive Test dashboard, the header is white: padding 12px 16px, a 1px `--uep-divider` rule under it, and a 28px app tile (radius 7) holding a white 16px icon. Use Home's tinted header band only when the cards stand for different apps.

Implementation: `Section` in `pages/drivetest` draws the tile from a Carbon icon name (`tile`, default `cell-tower`); the colour comes from `styles/dt-dashboard.css`. Inside a page that belongs to one app, figures are `--uep-text`, cobalt is the data colour for "done", `--uep-danger` is only for something bad, and nothing is green or teal in a chart.

## KPI strip

Home and the Drive Test dashboard share one strip (`styles/kpi-strip.css`, `components/KpiSpark.jsx`): a white container holding four transparent tiles. Each tile has a label, a 32px figure, a 12px change line and a 28px sparkline that draws in over 900ms, after which its 8% area fades in. The change line uses `--uep-danger` only when the change is bad, and a flat month reads "No change". Home lifts its first tile as the hero; the dashboard has no hero.

**Home keeps this standard size.** The Drive Test dashboard uses the **dense dashboard variant** (UEP-04a), scoped under `.dt-page` in `styles/dt-dashboard.css` so Home is never affected:

- Four equal columns (`repeat(4, minmax(0, 1fr))`, 6px gap). Tile padding `10px 16px 8px`.
- A 28px figure (600, −0.02em, line-height 1.15) and a 24px sparkline.
- Exactly one line under the figure (12px, 500, `--uep-text-3`, a fixed 18px line box): On air shows "+N this month" (or "No change this month"), from the same series as its sparkline; DT done and Pending show their change and "% of on air".
- The visual is pinned to the bottom of the tile (`margin-top: auto`), so every sparkline, and the Pending by status stack, ends on the same line. Pending by status lists three 20px rows (swatch, name, count, a fixed 34px share) over a 6px stack and is no taller than the other tiles.

## Chart interaction (standard for every UEP chart)

- **The readout replaces the floating tooltip (UEP-04a).** No tooltip ever covers the data. The key row under the card header is one flex row (wrapping when narrow, `8px 16px` padding, a 1px `--uep-divider` bottom border): the key on the left, the readout on the right. The readout is a pill (1px `--uep-border`, radius 8, `--uep-page`, `4px 10px`, 12px, no wrap) showing the month and year in Persian script (600, "· so far" for an open month), then each series as an 8px dot, its running total (600, `--uep-text`) and that month's change (`--uep-text-3`; `--uep-danger` only when the change is bad, with a visually hidden word). Its values are the same points the chart and its table draw.
- **Hover:** a 1px `--uep-border-strong` rule at the month and 8px white dots with a 2px stroke on each line. The readout follows the hovered month; with nothing hovered or focused it shows the latest month.
- **Keyboard:** the plot is one tab stop (`tabindex="0"`, `role="group"`) whose label explains the arrow keys. ← and → move a month; Home and End jump to the first and last. The readout is a polite live region, so the month moved to is announced, and focus shows the accent ring 4px out.
- **Axis labels:** the current month is always labelled, in `--uep-text` 600. Other month labels are thinned, counting back from the current month, so none overlap at the narrowest card width.
- **View as table:** a toggle (`aria-pressed`) swaps the plot for a table of the same derived points, newest first. The table has a sticky header on `--uep-page`, scrolls inside its card and has a visually hidden caption.

## Neutral data colour

`--uep-neutral-data` (#9AA1AE) is used for "Not started" and for folded or uncategorized data, never for a status. `--uep-track` (#F1F2F5) is the bar track.

## Work pages: the pipeline (UEP-06)

The Health check and Drive test work pages are **one pipeline on two pages** (`pages/pipeline/`, `components/work/`, `styles/work.css`). They use Home's frame (`.uep-home`: max-width 1280, padding `20px 24px 14px`, gap 16, 12 under `max-height: 820px`) and Home's card, type, controls and footer (`shell/AppFooter.jsx` is Home's footer, moved rather than copied). Page order: `PageHeading` → `PipelineStrip` → the step's list → `AppFooter`. No page scrolls at 1440×900; lists scroll inside their card.

**Colour roles (restated).** Cobalt `--uep-accent` is the selected step, primary actions, selection, checkboxes and the suggested contractor. Drive test teal is identity only: the card tool bar tint, the Health check volume bars and the contractor load bars. `--uep-danger` is late or rejected, and late is always written ("2 late"). **Ready is cobalt, not green**; `--uep-approved` is approved only (the DT done check). Everything else is grey.

### Pipeline strip: the standard for staged workflows

One white strip (1px `--uep-border`, radius 12, padding 6) in four groups split by 1px `--uep-divider` lines: Health check (flex 3, steps 1–3), Drive test (flex 3, steps 4–6), Outcome (flex 1, DT done) and Side loops (flex 1.35: Remediation, Re-routes, Sent back). Group captions are 12px/500 `--uep-text-3`, in sentence case.

- **Step tile** (a button, radius 8, padding `6px 10px 10px`, hover `--uep-page`): an 18px number circle and the short name (13px/500, ellipsis); the figure (24px/600, 20px when tight) with "**N late**" beside it only when there are any; and a 6px **volume bar** showing the step's count ÷ the largest of the six (minimum 3%), teal for steps 1–3 and cobalt for 4–6, `aria-hidden`.
- **DT done tile:** a green check circle, with "To acceptance" in place of the bar.
- **Hero = the current step:** Home's hero tile (`--uep-accent` fill, white figure, `--uep-accent-on-tint` labels, number circle and bar in white). Its focus ring is `--uep-text`.
- **Side loops:** full-width rows (label · "N late" · count). The selected one is cobalt with white text.
- **Semantics:** one `role="tablist"` ("Site pipeline"). Every tile and row is a tab with `aria-selected`, `aria-controls` pointing at the list card (a `tabpanel` labelled by the tab), and a roving tab stop. ←/→ move in strip order, Home/End jump, and moving selects (the URL changes). Each tab's name is a sentence: "Step 5, In test: 263 sites, 4 late, with contractors".
- Counts come from `GET /drive-test/pipeline/summary` and are read again after every action.

### WorkListCard

Home's card (white, 1px border, radius 12, hover shadow) whose header is a single tool bar on `--uep-app-drive-test-tint` (padding `10px 16px`, 1px bottom border). Tools sit on the left (search 220px, selects, toggles, all 34px high) and a 13px `--uep-text-3` description on the right. The body scrolls inside; the assign panel or pager sits at its foot.

### SiteTable and WaitingCell

`table-layout: fixed` with a `colgroup`, so the table fills its card at every width, with no empty right side and no horizontal scroll. The checkbox column is 52px with a 32px hit area; the header is 40px (12px/500, sticky); rows are 44px with `0 16px` padding, ellipsis, hover `--uep-row-hover` and selected `--uep-accent-tint`. The assign steps have no Type column and no province group rows. Clicking a row (not its buttons or links) toggles it; Shift-click selects a range; the header box selects the whole filtered set; selection survives filtering.

**Sort:** longest waiting first. **"Sort by province"** (on by default, `aria-pressed`) orders provinces by their longest wait, then sites by wait (`lib/siteOrder.js`).

**WaitingCell:** "21 d" (14px/600, min-width 36px, right-aligned) and a 120×4px bar filling toward the queue's SLA. Past the SLA both turn `--uep-danger` and a hidden " late" is read out. The SLA comes from the API and is never a constant; the header reads "Waiting · SLA 14 d".

### AssignPanel

A band at the foot of the list card (1px top border, padding `12px 16px`), on `--uep-selection-wash` with a `--uep-selection-edge` top border while sites are selected. A 190px lead block ("Contractors" or "Assign N sites to", the suggestion, Clear selection) sits beside one card per contractor in a one-row grid (`repeat(n, minmax(0, 1fr))`). Each card shows the name and open count, a 4px load bar (open ÷ the highest open), and "Suggested · 1 late · avg 5 d".

- **Order:** lowest open load first. With sites selected, the suggested contractor comes first, with a cobalt 1px + 1px inset border.
- **Suggestion rule** (`lib/suggestContractor.js`): the contractor whose 90-day coverage includes the most provinces of the selected sites. Ties go to the lower open load. There is no suggestion when nobody covers any of them.
- **One click assigns.** Cards are `aria-disabled` until something is selected, and each card's accessible name is the full sentence.
- **The confirmation persists:** "✓ 2 sites assigned to رعد." with Undo and a dismiss stays in the panel until it is dismissed or the next selection starts. It never runs on a timer (WCAG 2.2.1). The same text is announced through the page's one persistent `role="status"` region. A step without a panel shows it as a bottom-centre message with the same rules. Leaving a step clears it (WCAG 2.4.11); Undo stays in History.

### ReviewPanel

The 360px right panel of DT review: the Site ID (18px/600) with type, province and contractor; Carried out, Submitted (Shamsi, Persian digits) and Waiting; the report files or a "No report attached" note; **Comment for the contractor**, with help text linked by `aria-describedby`; and Approve (primary) and Send back (danger, `aria-disabled` until the comment has 3+ characters). The open row has a 3px cobalt inset. **J / K** move only while focus is in the list (WCAG 2.1.4). After a decision the next row opens.

### RecentActions (History)

`?tab=history` on either page (and `/explorer?view=history`): "Your recent actions. Each one can be undone for 2 minutes." Columns are Time · Action · Undo, with "{s} s left", then "Can no longer be undone" or "Undone". The server decides whether an undo is still allowed (same user, two minutes, nothing acted on since).

### States

- **Empty:** "Nothing here right now", centred in the card.
- **Loading:** strip and row skeletons at their final size, never a spinner.
- **Error:** "Couldn't load {step}." with Retry inside the card; the rest of the page still renders.
- **Saving:** the pressed control is disabled with `aria-busy`.

## Explorer: the list (UEP-11a)

The list of all sites (`pages/explorer/ExplorerList.jsx`, `styles/explorer.css`,
`.exl-*`). Max width 1200px plus 24px gutters; one card fills the height:

- **Title row:** "Explorer" and a neutral count pill (`.uw-count-pill`, 12px,
  grey tint with a 1px inset border; `PageHeading` with `pill`), History and
  Export on the right.
- **Tool bar (56px):** a 380px search field whose focus is a cobalt border
  plus `--uep-focus-ring`, with a clear button; active filter chips in
  cobalt tint ("Province **کرمان** ×"); **Filter** on the right opening a 230px
  popover: an uppercase 12px "FILTER BY" title, the fields, then one field's
  values behind a back row. No Sort button: the headers sort.
- **Header row (40px, sticky):** 12px, 600, uppercase, letter-spacing .06em,
  muted, as the Roles Performance group titles. Each label is a button; the
  sorted one is in ink with an arrow and carries `aria-sort`.
- **Rows (48px):** one CSS grid template for header and rows, so no column
  takes all the spare width. The site code is the row's link, its `::after`
  stretched over the row; the checkbox and the villages pill sit above it
  (`z-index: 1`). Hover: `--uep-row-hover-accent` with a 3px cobalt inset edge,
  the code turns cobalt and a cobalt chevron slides in 4px. A focused row
  (`:focus-visible` on its link) gets a 2px cobalt inset ring. Selected:
  `--uep-row-selected` and a filled checkbox, which otherwise shows only on
  hover or focus.
- **Field icons** are the record page's General information hues
  (`FIELD_ICONS`, `--uep-field-*`) as 16px line icons at 80% opacity, no tile:
  pin for province, signal for technology, building for villages, briefcase
  for DT contractor; grey when the value is missing. No other colour on the
  list: cobalt is only for actions, links, selection and focus.
- **Inline villages:** a strip under the row (page grey, 52px indent), a
  chip per village (name 600, ID 12px muted); the one a search matched is
  marked with `--uep-search-mark` and a cobalt border.
- **Footer (44px):** "Showing **50** of 4,201 sites" ("matching sites" when
  narrowed) and the keyboard hints.
- **Bulk bar:** deep cobalt (`--uep-brand-deep`), white text, bottom centre
  of the card: "{n} selected", Export, Copy IDs, ×.
- **States:** 12 shimmering skeleton rows under the real header; "No sites
  match" with **Clear search and filters**; "Couldn't load sites." with Retry.

## Explorer: the record page (UEP-11)

A site's record (`pages/explorer/`, `styles/explorer.css`) on Home's frame
(`.uep-home`), Home's card and header (`.hw-card`, `.hw-head`), Home's colour
tiles (`.uep-app-tile`) and the work pages' buttons (`.uw-btn`). It fills the
height under the shell: no page scroll at 1440×900 up to six villages; at
1366×768 only the village lists scroll. Every date on Explorer is Gregorian,
"6 Oct 2026" (`lib/dates.formatGregorian`, `Intl` en-GB), an exception to the
Shamsi rule that holds on Explorer only.

**Colour roles.** Cobalt `--uep-accent` is the journey and primary actions;
deep cobalt `--uep-brand-deep` is the ICT and CRA labels. Green, yellow and red
are approved, pending and rejected, and nothing else. Everything else is grey.
Every status has an icon and a word.

### Header

Breadcrumb "Explorer / {site ID}", then the site ID (24/600) and **one** badge
for the current step ("Acceptance in progress" on `--uep-accent-tint`,
"Acceptance done" on `--uep-status-success-soft`). Nothing under the title. On
the right: Take action (secondary, only when the user has an action), Open in
My Work (secondary) and File letter (primary, filing roles only).

### General information list with colour icon tiles

A fixed 360px card. Rows are 62px: a 36px rounded tile in the field's colour
with a 20px white Carbon icon, the label (14px `--uep-text`) and the value
right-aligned (14/600), with hairline `--uep-divider` rules. One token per tile:
`--uep-field-on-air`, `-dt-date`, `-site-contractor`, `-dt-contractor`,
`-technology`, `-province`, `-villages`; each holds at least 4.5:1 against the
white icon. A missing value is "—" in `--uep-text-3`. Persian values are
wrapped in `<bdi dir="rtl" lang="fa">` in Vazirmatn (`Fa`).

### Compact aging tiles

Four equal tiles in one row (1px border, radius 8, padding `7px 12px`): a 26px
tinted icon tile, a 12px label, then the value (14/600) and a 12px muted
context on one line. They stay smaller than the steps below. Oldest pending is
the yellow one and is left out when nothing is pending. A value that cannot be
computed is "—".

### Step path with aging pills

Five steps on one line, in the process's order (On air, Health check,
Assigned, DT done, Acceptance), as an ordered list whose items are named
"{Step}: {state}, {date}". Each step is a 48px circle with its icon, the name
(15/600) and the date (13px). Done: filled cobalt and a solid cobalt line in.
Current: white with a 2px cobalt ring, a dashed `--uep-explorer-step-dash` line
in, and "In progress" in cobalt. Between two steps a pill shows the days from
the previous one ("+7 d"; "+8 d so far" on the open step, cobalt tint). A gap
the server cannot measure is "—", never negative; a step without a date reads
"No date". No "Day N", no "N of 5" counter.

### Acceptance: the two-panel / table switch at six rows

Title "Acceptance by village" with an **All n / Open n** filter
(`role="tablist"`, ←/→, Home/End) that cross-fades the rows (160ms). Rows are
ordered once for both authorities: any rejection, then more pending sides, then
the longest wait, fully approved last.

- **Up to six villages:** ICT and CRA as two panels. A light grey head with the
  deep-cobalt label (32px, 14/700 white) and three large counts (24/600 in the
  status ink, the word under each; zero is grey). Rows: name (14/600) and ID
  (12px muted), then the status cell. 62px rows up to three villages, 50px for
  four to six.
- **Above six:** one table. A sticky light-grey header row "Village | ICT + its
  counts | CRA + its counts", 52px rows, and a thin visible scrollbar; only the
  body scrolls, inside a focusable, labelled region.
- `?village=` tints the row (`--uep-accent-tint`), scrolls it into view and
  focuses it.

### The fixed status column and the status mark

The status cell is a fixed 250px, left-aligned, so the marks line up in one
column. The mark is a 28px circle with a tinted fill and a coloured icon
(approved: green tick; pending: amber clock; rejected: red cross), the word in
the status ink (14/600) and a 12px muted line under it ("6 Oct 2026, took 4
days", "Answer filed 7 Oct 2026, with coordinator", "Not filed yet"). A
Re-filed or Returned chip sits beside a pending word. Data without dates shows
the word only.

### Motion and states

The page fades in once (240ms); the two cards rise in, Journey 60ms after
General information (see Motion); hover is 120ms; under reduced motion nothing
animates. Loading draws skeletons at their final size;
an error reads "Couldn't load {section}." with Retry inside each card. "No
hadaf villages on this site." and "Acceptance starts when the site is on air
and drive-tested." stand in for the village block.

## Roles Performance: measure list and deviation bar (UEP-09)

Month and Area share one layout: a **measure list** on the left (288px, 224px below 1320px; `--uep-measure-list`, `--uep-measure-list-tight`) and the selected measure's breakdown on the right. The page never scrolls; only the owner columns, the ranking and, on short screens, the pipeline scroll inside their cards.

- **Measure list** (`MeasureList.jsx`): groups under a 24px icon tile (`--uep-accent-tint`), an uppercase 12px title and the unit. A row is a button; the selected one is solid `--uep-accent` with `--uep-on-accent` text (muted parts on `--uep-accent-on-tint`), one at a time, `aria-pressed`. Headline rows: name 600, figure 20px `--uep-weight-bold`. Others: 34px, secondary ink. Area's five measures are equal 60px rows; Total villages is an information row on `--uep-page`, not a button.
- **One accent.** Colour marks the exception only. Month's share strip (14px, `--uep-share-strip`): leader `--uep-accent`, second `--uep-rank-second`, the rest `--uep-border-strong`, Unattributed hatched grey and last. Where fewer is better, the top two are `--uep-text` / `--uep-text-3`, never red. No green on this page.
- **Deviation bar** (`RankBar.jsx`, 10px, `--uep-rank-bar`): `--uep-track` with a 1px `--uep-border` inset; `--uep-neutral-data` up to the lower of rate and national; the difference solid `--uep-accent` when better, or `--uep-danger-stripe`/`--uep-danger-tint` stripes with a `--uep-danger-edge` inset when worse; a 2px `--uep-text` tick at national. The fill grows over `--uep-dur-grow` with `--uep-ease-grow`, the difference `--uep-grow-follow` later; off under reduced motion. Every bar has a spoken label ("Qazvin 40%, national 51%, 11 points behind"), and every gap is also signed text.
