// The Acceptance Dashboard's colour vocabulary, shared by every file under
// pages/reports/ that draws a piece of it.
//
// Kept separate from AcceptanceDashboard.jsx itself (which used to define
// these locally) so that the page's own new sections — AcceptancePlanSection,
// PlanTargetCard, the acceptancePlanCharts widgets — can import them without
// creating a circular import back into the page component that renders them.

// ICT and CRA get a stable accent colour each, reused across every card and
// table so the eye can track one authority at a glance when they sit side by
// side. The verdict colours are the platform's and mean the same thing here
// as everywhere else: green decided yes, red decided no, amber nobody has
// said.
export const ICT = 'var(--signal, #4f8cff)'
export const CRA = 'var(--violet, #a06bff)'
export const APPROVED = 'var(--green)'
export const REJECTED = 'var(--red)'
export const PENDING = 'var(--amber)'
export const IDLE = 'var(--text-dim)'
// A neutral line colour for a plan/target series, which is neither an
// authority nor a verdict — grey, the same role `--text-dim` plays for "no
// answer yet" everywhere else on this page.
export const PLANNED = 'var(--text-dim)'

// The washed-out background each accent gets behind an icon chip — the
// tokens the design system already defines for exactly this, rather than
// computing a tint ad hoc per use site.
export const WASH = {
  [ICT]: 'var(--signal-glow)',
  [CRA]: 'var(--violet-dim)',
  [APPROVED]: 'var(--green-dim)',
  [REJECTED]: 'var(--red-dim)',
  [PENDING]: 'var(--amber-dim)',
  [IDLE]: 'var(--surface-3)',
}
