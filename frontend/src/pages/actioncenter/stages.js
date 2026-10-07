// The five lifecycle steps of the board, in order, by the names the approved
// design gives them. Every role sees all five; a step with nothing for this
// person says so. The marker colours are the stage tokens in app.css
// (--stage-<key>-chip / -ink), read through data-stage, and are used for the
// step markers only (design-system-cobalt.md, amendment D).
export const STEPS = [
  { key: 'hc', name: 'Health Check' },
  { key: 'dt', name: 'Drive Test' },
  { key: 'ict', name: 'ICT acceptance' },
  { key: 'cra', name: 'CRA acceptance' },
  // Not a step in the line: it runs alongside the lifecycle.
  { key: 'plans', name: 'Plans & Data', alongside: true },
]

export const stepHeadingId = (key) => `ac-step-${key}`
