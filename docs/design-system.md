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
| My work | `--uep-app-my-work` | `#1D4ED8` | — |
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
| My work | `task` |
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
