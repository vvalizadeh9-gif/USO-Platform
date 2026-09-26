/**
 * The USO Platform mark: a signal source at the bottom-left with two arcs of
 * coverage radiating toward the top-right, white on the brand teal.
 *
 * Decorative (`aria-hidden`) -- it always sits beside the "USO Platform"
 * wordmark, which is what names the product to a screen reader.
 */
export default function BrandMark() {
  return (
    <svg
      className="brand-mark"
      width="34"
      height="34"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="9" fill="#0B8477" />
      <g fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round">
        <path d="M9.5 15 A7.5 7.5 0 0 1 17 22.5" />
        <path d="M9.5 9.5 A13 13 0 0 1 22.5 22.5" strokeOpacity="0.55" />
      </g>
      <circle cx="9.5" cy="22.5" r="2.6" fill="#FFFFFF" />
    </svg>
  )
}
