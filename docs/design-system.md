# UEP design foundation

The look every new UEP page is built on, starting with Sign-in. The values live
in `frontend/src/styles/uep-tokens.css` (the source of truth) and are mirrored
for script in `frontend/src/design/tokens.js`; `tokens.test.js` fails if the
two disagree. Change a token there, then here.

Pages not yet moved over still use the older "Cobalt" system
(`design-system-cobalt.md`, `app.css`). They move one page per change.

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
| Header | `shell/AppHeader.jsx` | `--uep-header-height`, `--uep-search-max`, `--uep-search-height` |
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

`?tab=history` on either page (and `/work-items?view=history`): "Your recent actions. Each one can be undone for 2 minutes." Columns are Time · Action · Undo, with "{s} s left", then "Can no longer be undone" or "Undone". The server decides whether an undo is still allowed (same user, two minutes, nothing acted on since).

### States

- **Empty:** "Nothing here right now", centred in the card.
- **Loading:** strip and row skeletons at their final size, never a spinner.
- **Error:** "Couldn't load {step}." with Retry inside the card; the rest of the page still renders.
- **Saving:** the pressed control is disabled with `aria-busy`.
