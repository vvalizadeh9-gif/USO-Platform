// The white-label rule: an operator (tenant) changes the brand values and
// nothing else. Status colours (late, due soon, done), data colours and
// neutrals are fixed, so a tenant's theme can never make "late" look calm.
//
// The brand appears on the logo, the one primary button, the Up-next
// highlight, the hero tile and the focus ring -- every one of them reads the
// --brand* custom properties, so a theme is this one small object.

/** UEP's own brand. The tokens in styles/home.css default to these. */
export const DEFAULT_BRAND = Object.freeze({
  brand: '#2563EB',
  brandHover: '#1D4ED8',
  brandSoft: '#EFF6FF',
  brandInk: '#1E3A8A',
  brand950: '#172554',
})

const PROPERTY = {
  brand: '--brand',
  brandHover: '--brand-hover',
  brandSoft: '--brand-soft',
  brandInk: '--brand-ink',
  brand950: '--brand-950',
}

/** Apply a tenant's brand to `root` (the document by default). Unknown keys
 * are ignored; missing ones keep the default. */
export function applyBrand(brand, root = document.documentElement) {
  for (const [key, property] of Object.entries(PROPERTY)) {
    if (brand?.[key]) root.style.setProperty(property, brand[key])
  }
}
