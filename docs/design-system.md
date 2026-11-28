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
  title · 18 section · 24 page title · 26 greeting · 28 (`--uep-fs-signin-title`, kept for page heads and figures) · 32 KPI. The sign-in
  title is fluid (`--uep-fs-signin-display`, 32–54px).
- Line height `--uep-lh-ui` 1.45. Headings of 22px and up track tighter:
  `--uep-tracking-heading` −0.02em, the sign-in title −0.025em.

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

## 7. Sign-in (UEP-26)

One centred card on a white page, resting on the edge of a deep cobalt band
(`clamp(300px, 53vh, 490px)` high). The band carries the UEP mark and "UEP"
top-left and the decorative title *USO Enterprise Platform*
(`clamp(32px, 3.7vw, 54px)`) with a 56×3 white rule; the card's `<h1>` is the
page heading. Two sets of wave rings, clipped to the band: four 1520px
`--uep-brand-wave` rings from its bottom-right corner (16s, 4s apart) and three
1800px `--uep-signin-wave-b` rings from its top-left (24s, 8s apart). The
footer reads "© {year} USO" · "Authorised use only. Sign-ins are recorded." ·
"UEP {version}". Component tokens are `--uep-signin-*`; the stylesheet is
`styles/signin.css`, shared by Change password.

Steps (`pages/Login.jsx`, views in `pages/auth/`): **username** (Continue, no
server call) → **password** (account chip with "Not you?", Caps Lock hint,
show/hide). A remembered username opens on the password step. A 429 shows the
neutral lockout box — a 30px ring that empties once a second and an m:ss
countdown from `Retry-After` — and disables the field and button. "Forgot
password?" and "Need access?" open the **help panel** inside the card, with the
contact set in Admin › Sign-in page, rendered as text. `/login?help=1` opens
it; `/forgot-password` and `/request-access` redirect there. Notices (planned
update, session expired) use the neutral `--uep-page` box.

Fits 1366×768 and up with no page scroll (`max-height: 780px` tightens the
title and card); below 600px the card goes full width and the page may scroll.

Motion, all transform/opacity and all off under reduced motion (waves hidden):
band fade 600ms; the mark's three arcs draw in (1s, 140ms apart); the title's
words rise from a mask (900ms, 120ms apart); the rule draws from its centre;
the card rises 14px at 500ms and its fields arrive 60ms apart; a step slides in
16px (260ms); an error shakes the field (340ms); a successful sign-in drops a
cobalt curtain with "Opening Home" and navigates within 900ms.

**The UEP mark** is a corner with three signal arcs: `assets/uep-mark.svg` (light
backgrounds: the header at 26px, the favicon) and `assets/uep-mark-on-dark.svg`;
`components/UepMark.jsx` draws it inline where the arcs animate. Inputs use
`--uep-signin-input-edge` (#868F9F, 3:1 on white).

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

## Drive test pages refined (UEP-31)

Supersedes the strip, AssignPanel and WaitingCell notes above for the six Drive test work pages.

### Flow strip

One white card (1px `--uep-border`, radius 12) in three groups split by 1px dividers: **Health check** (1 · Assign → 2 · Checks), **Drive test** (3 · Assign → 4 · Tests) and **Exceptions** (Remediation, DT done). Group caption 12/500 `--uep-text-3`; a grey Carbon `chevron--right` between steps. Each step is a tab: label 13/500 `--uep-text-2`, the number 24/600 tabular, `N to decide` (13/500 cobalt) and `N late` (13/500 `--uep-danger`, only when > 0). Always "late", never "overdue". DT done shows a green `checkmark--filled` and is not a tab. No band notes, owner lines, hatching or fills. The page heading has no meta line and the rail shows no count for the four steps (`railCount: false`); Remediation and Submissions keep theirs.

### Selected states (no blue fill)

| Element | Selected look |
|---|---|
| Flow step | no fill; label `--uep-text` 600; a 3px line in the stage colour on the card's bottom edge (cobalt, `--uep-app-drive-test`, `--uep-app-monthly-plan`) |
| Contractor button, team tile, assignment card | white, 1px `--uep-text` border + 1px inset ring; the contractor button adds an 18px dark circle with a white `checkmark` |
| Batch row (Checks list) | `--uep-hover` + 3px inset left edge in `--uep-text` |
| Ticked table row | `--uep-work-row-selected` (#F3F6FD) with the 3px cobalt edge |

Solid cobalt is only the one primary action on a screen. Green is only Ready / DT done / completed, red only late and not ready, yellow only pending and due soon.

### VillageCount

`components/work/parts.jsx`. The number of villages (14/500 cobalt, tabular) and a 14px `chevron--down`; `N new` (12/500, `--uep-accent-hover`) when CPM added villages. A click (Enter, Space) opens a fixed-position popover (white, 1px border, radius 8, popover shadow): `N villages` (12/500 `--uep-text-3`), then one row per village, name in Vazirmatn 13 and code 12 tabular, `· New in CPM` when new. Esc, an outside click or a second click closes it and focus stays on the button. `aria-expanded`, `aria-label="3 villages, show names"`. The click never toggles the row.

### Waiting cell

Days only (`19 d`, tabular), `--uep-danger` 600 past the step SLA, with a hidden " late". No bar.

### Assign: Contractors column

The list card on the left and a 232px column on the right (`--uep-assign-column`, gap 16). Header `Contractors` 16/600 and `Manage` (13/500 cobalt) for users with the `contractors` feature. One 44px button per contractor shown in Drive test, A to Z, 8px apart: the name (14/500) and one number, the basket (14/600 tabular). `role="radiogroup"` / `role="radio"`, `aria-label="Pars Rayan, 18 sites in basket"`. Footer: `N sites · M villages` and Clear (or `No sites selected`), and the 40px primary `Assign to <contractor>` (`Assign` while disabled). A click with no sites selected shows "Select sites first".

### Checks: inbox

A 360px batch list (`--uep-inbox-list`, `role="listbox"`, Up / Down move, Enter opens) and the open batch on the right. A row: an 8px cobalt dot and a 600 code while results wait, the Round flag, the status pill (grey `Due in 23 h`, yellow under 12 h, red `Late 2 h`, green `Completed in 31 h`, red when completed after the SLA), a 6px bar of ready / not ready / pending, and `■ 6 ready ■ 1 not ready ■ 5 pending` with coloured squares. No contractor anywhere on the page.

### Motion

| What | Motion |
|---|---|
| Buttons, tiles, steps | press scale .98, `--uep-dur-press` (100 ms) |
| Hover / selection | `--uep-dur-fast` (150 ms), standard ease |
| Flow strip numbers | count up from 0 on the first open only, 700 ms ease-out |
| Step line | grows from the centre, `--uep-dur-step-line` (240 ms), entrance ease |
| Checks: another batch | fades in from 8px right, `--uep-dur-swap` (220 ms) |
| Assign | rows slide out; the chosen contractor's number bumps (1 → 1.25 → 1, `--uep-dur-bump`) once the load reloads; check pops in, `--uep-dur-check-pop` |
| Villages popover | fade + 4px rise, `--uep-dur-pop` (160 ms) |
| Checks bars | fill from the left, `--uep-dur-fill`, on page open only |

All of it stops under `prefers-reduced-motion` (and `data-uep-motion="reduce"`); none blocks input.

## Explorer: type scale and colour roles (UEP-28)

The list (`pages/explorer/ExplorerList.jsx`, `.exl-*`) and the record
(`SiteRecord.jsx`, `.ex-*`, `.exp-*`, `.exj-*`, `.exr-*`, `.exa-*`, `.exh-*`)
share one stylesheet (`styles/explorer.css`), its tokens (the Explorer block in
`uep-tokens.css`) and its motion. No page scroll at 1440×900 or 1366×768:
only the list body, the village table and the history panel scroll.

| Role | Size |
|---|---|
| Site ID on the record | 32/600 |
| List title | 24/600 |
| Card titles | 16/600 |
| Section titles | 14/600 |
| Data | 14 |
| Labels and second lines | 13 |
| Codes only (village IDs, list column headers) | 12 (village IDs: Plex Sans 12/500, tabular, .02em) |
| Big numbers (journey numbers) | 20/600 |

ICT/CRA chips are 13/700 everywhere on Explorer (`auth-chip ex-auth`). No size
outside 12/13/14/16/20/24/32; `explorerTypeScale.test.js` resolves every
`font-size` in the stylesheet and `e2e/explorer.spec.js` walks the computed
styles. Colours: cobalt for the journey, actions, links, selection and focus;
green approved only, yellow waiting, red rejected or late only; ICT plum and
CRA blue, never green. Every colour is a token. Dates on Explorer are Gregorian
("6 Oct 2026", `formatGregorian`).

### Filter pills

Province, Site type, Technology, DT contractor as 34px pills beside the search
(`FilterPills.jsx`, `.exf-*`). Empty: a dashed outline and a chevron. One click
opens a 240px menu of values (Province gets a search box); one click chooses.
Chosen: solid, cobalt tint, "Province **کرمان**" with a × to remove it.
"Clear filters" appears at the right while any filter is set. Escape or a
click outside closes; focus returns to the pill.

### Stage mini-bar

The list's Stage cell (`StageCell` in `SiteRows.jsx`): a 72×6 bar (steps done
out of six in cobalt, the open step as a striped light-cobalt segment), the
open step's short name, then "· {n} d". Days turn red with a `warning--alt`
mark only over that step's SLA. Done: a green check and "Accepted", no days.
One accessible name per cell: "Drive test, 14 days, over SLA".

### List rows and the village match

44px rows: checkbox, site code (14/600) with its type tag ("New" / "Add tech",
12px neutral outline), province (Vazirmatn), the villages pill ("—" when 0),
technology chips, DT contractor ("Not assigned" muted), Stage, and the chevron
that slides in on hover. No row icons. When the search matched a village, a
38px line under the row shows it (connector mark, "Village", name and ID with
the match marked, "+n" for more) and **Open record**, which lands on that
village (`?village=`). The title row sits on the page background, aligned with
the card: the Explorer app tile, "Explorer" and the count pill ("97 of 4,201
sites" in cobalt tint while narrowed, a polite live region). No footer; the
keyboard hints are the search box's tooltip, and `/` focuses the search.

### Site passport

One card in four cells (`SitePassport.jsx`): **Province** (a 112px map of Iran
from `iranMini.json` — built by `scripts/build-iran-mini.py`: integer
coordinates, points under 4 units apart dropped, centroids precomputed — with
only this province filled in Explorer cobalt and a pin on its centre, then the
name at 16/600 Vazirmatn on a soft cobalt wash; the "Province" heading is
visually hidden); **Target villages** (grey count pill, "History · {n} changes"
in words — "1 change", or just "History" — village chips on at most two lines
then "+n more"; a chip highlights its table row and is disabled before
acceptance starts); **Site type** (plain text) over **Technology** (44×30
soft-blue tiles, requested technologies only, one line, the group named
"Requested technology: 3G, 4G"); **Contractors** (two rows 10px apart: a 30×30
grey icon tile — `cell-tower` for the site contractor, `car` for DT — then
name over role; "Not assigned" muted). No CRA region. On air and DT dates are
on the ribbon instead.

One text rule (UEP-30): section titles 14/600 `--uep-text` in a 28px row so the
four line up; values 14/500; second lines 13/400 muted; cells padded 14×18 and
top-aligned (Province centred). Columns `.75fr / 1.95fr / .9fr / .9fr` (220px
minimum for Province); the card stays about 140px at 1440×900 and 1366×768.

### Village chip

`VillageChip.jsx` (`.exv`), the same in the passport, the list's villages strip
and the history panel: 30px high, 8px radius, name Vazirmatn 14/500, ID Plex
Sans 12/500 with tabular figures and .02em tracking, centred. No numbers on
chips. The acceptance table and the list match line use the same ID style.

### Journey ribbon

`JourneyRibbon.jsx` draws `ribbonModel.layoutRibbon` at its real pixel width
(re-laid out by a `ResizeObserver`):

- finished steps on a real time scale: a segment's length is its days, never
  under 124px (164px for the first, whose label is left-aligned); the others
  shrink proportionally; thin white cuts mark each step;
- the open step is a light-cobalt segment up to a dashed **Today** marker;
  days sit above the line ("8 d"; "16 d so far" in cobalt 13/600), names
  (14/600) and dates (13) below; **On air** and **DT done** are the big pins
  (filled dot, date 16/600 cobalt);
- from DT done the line forks into an **ICT lane (plum)** and a **CRA lane
  (blue)**, 6px tracks filled by approved ÷ villages, ending in the chip and
  "**2** of 3 approved" or "All approved · 21 Nov 2026" in green; Sent to ICT is
  a pin on the ICT lane;
- steps still to come are a dashed grey tail with hollow dots ("Acceptance ·
  ICT · CRA").

The drawing is `aria-hidden`; the container is `role="img"` with every step's
date or "in progress, N days so far" and both lanes in its name.

### Acceptance by village: one table

Village (27%) | ICT | CRA, for every site. A sticky 46px header: each
authority cell has a 3px plum/blue top edge, the chip and "**2** approved ·
**1** pending · **0** rejected" (13, coloured numbers, grey at zero). 58px rows
(52px under 820px of height): name 14/600 Vazirmatn and ID Plex Sans 12/500, then each
side's mark, word, Re-filed tag and one dated 13px line — dates only, never an
age. Worst first (rejected, pending, approved), then village code. The box
ends where its rows end; only its body scrolls. Before acceptance: a dashed
box, "Acceptance starts when drive test is done."

### Side panel with export

The village history (`VillageHistoryPanel.jsx`): 460px from the right over a
scrim, focus trapped (`useDialogFocus`), Esc closes and returns focus. Header:
title, "{site} · {n} target villages", **Export to Excel** (with the Exports
feature) and close. Body: current villages as chips, then a vertical timeline,
newest first: "Village added" (plus) or "Village removed" (minus, name struck
through once applied), "CPM import · {date}", the chips, and "Applied by {name}
on {date}" or "Ignored by {name} on {date} · still on this site" in yellow.

### Motion

Off under `prefers-reduced-motion` and `data-uep-motion="reduce"`. List: rows
rise (6px + fade, 360ms, 24ms stagger, first 20), stage bars grow (450ms),
pills and menus pop (160ms), the match line and the villages strip open
(220ms, grid rows 0fr → 1fr), the bulk bar rises (220ms). Record: the passport
then the Journey card rise; the province fills (500ms) and the pin drops
(420ms, expressive ease); chips cascade (50ms); the ribbon reveals left to
right (clip-path, 950ms) with each label fading in as the line reaches it;
the lanes fill; table rows rise (30ms stagger) after the ribbon. History
panel: slides in (260ms), events rise in turn. Hover and focus 120–150ms. No
count-ups, pulsing or loops.

## Roles Performance: measure list and deviation bar (UEP-09)

Month and Area share one layout: a **measure list** on the left (288px, 224px below 1320px; `--uep-measure-list`, `--uep-measure-list-tight`) and the selected measure's breakdown on the right. The page never scrolls; only the owner columns, the ranking and, on short screens, the pipeline scroll inside their cards.

- **Measure list** (`MeasureList.jsx`): groups under a 24px icon tile (`--uep-accent-tint`), an uppercase 12px title and the unit. A row is a button; the selected one is solid `--uep-accent` with `--uep-on-accent` text (muted parts on `--uep-accent-on-tint`), one at a time, `aria-pressed`. Headline rows: name 600, figure 20px `--uep-weight-bold`. Others: 34px, secondary ink. Area's five measures are equal 60px rows; Total villages is an information row on `--uep-page`, not a button.
- **One accent.** Colour marks the exception only. Month's share strip (14px, `--uep-share-strip`): leader `--uep-accent`, second `--uep-rank-second`, the rest `--uep-border-strong`, Unattributed hatched grey and last. Where fewer is better, the top two are `--uep-text` / `--uep-text-3`, never red. No green on this page.
- **Deviation bar** (`RankBar.jsx`, 10px, `--uep-rank-bar`): `--uep-track` with a 1px `--uep-border` inset; `--uep-neutral-data` up to the lower of rate and national; the difference solid `--uep-accent` when better, or `--uep-danger-stripe`/`--uep-danger-tint` stripes with a `--uep-danger-edge` inset when worse; a 2px `--uep-text` tick at national. The fill grows over `--uep-dur-grow` with `--uep-ease-grow`, the difference `--uep-grow-follow` later; off under reduced motion. Every bar has a spoken label ("Qazvin 40%, national 51%, 11 points behind"), and every gap is also signed text.
