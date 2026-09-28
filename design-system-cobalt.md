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
2. **Cobalt (`--accent`) means selected or action — nothing else.** It is not a
   data colour, not a bar fill and not a decorative icon tint.
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
| `--ict-base` | `#EBD3E4` | ICT faint "base" column |
| `--ict-soft` | `#F5E6F1` | ICT chip background |
| `--cra` | `#23A396` | CRA data fill (3.1:1 on white — graphics only, never text) |
| `--cra-ink` | `#0F6F66` | CRA text ink (6.0:1 on white, 5.2:1 on `--cra-soft`) |
| `--cra-base` | `#C9EAE5` | CRA faint "base" column |
| `--cra-soft` | `#DDF3F0` | CRA chip background |

The ICT/CRA pair was checked with a colour-vision validator: it passes against
each other and against `--accent`. It sits just under the comfort line against
the Ongoing/Problem/Done status colours, which is acceptable only because of
rules 3 and 4.

First used on **Performance → Lifecycle Gaps**. Other pages move to these
tokens one page per change. (The Acceptance Dashboard still uses its own
`--blue` for ICT until it is migrated.)

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

### Banners

Info, warning, error and success each have `-bg`, `-border`, `-text` and
`-icon` tokens (`--banner-warning-bg` etc.). A banner always says its message
in words; the tone only colours it.

### Type

| Role | Size / line | Weight |
|---|---|---|
| Display (page title) | 28 / 36 | 600 |
| Figure (a headline number) | 30 / 38 | 600, tabular |
| Card heading | 17 / 24 | 600 |
| Block / tile title | 15 / 22 | 600 |
| Body | 15 / 22 | 400 |
| Small / eyebrow | 13 / 18 | 600 for eyebrows |
| Caption | 12 / 16 | 400 |

Inter for Latin and figures, Vazirmatn for Farsi (`--font-farsi`). Farsi names
in data are 15px Vazirmatn, `dir="rtl"` or `dir="auto"`.

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

- **PageHead** — eyebrow (13/600, `--text-link`), title (Display), optional
  subtitle, actions on the right.
- **Tabs** — real `role="tab"`; arrow keys move and select.
- **SegmentedControl** — one choice out of a few; every option is a button with
  `aria-pressed`.
- **Card** — white, radius 10, padding 20/24; optional header with a neutral
  36px icon chip, heading, description and actions.
- **Banner** — info / warning / error / success.
- **EmptyState** — the "nothing to show" and error state, with the server's
  message.
- **Selectable tile** — `--surface-subtle`, 1px `--track`, radius 8, padding 16.
  Selected: `--accent-wash` fill and a 2px `--accent` border.
