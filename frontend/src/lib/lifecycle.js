// The drive test process in three steps, as the pages that show it name
// them. One list for the full LifecycleStrip (contractor pages) and the
// compact ProcessStepper in the PageBar (staff pages), so the two can never
// disagree about what the steps are or where they lead.
//
// Two variants, not one list reused with different labels: a contractor's
// three steps are three different screens (My Health Check, My Drive Tests),
// so the `to` targets differ and not just the wording.

export const STAFF_STEPS = [
  { key: 'plan', label: 'Monthly Plan', hint: 'Target for the month', to: '/monthly-plan' },
  { key: 'hc', label: 'Health Check', hint: 'Check · confirm · route fixes', to: '/health-check' },
  { key: 'dt', label: 'Drive Test', hint: 'Assign · progress · review', to: '/drive-test' },
]

export const CONTRACTOR_STEPS = [
  { key: 'plan', label: 'Monthly Plan', hint: 'Your count for the month', to: '/monthly-plan' },
  { key: 'hc', label: 'My Health Check', hint: 'Sites to check', to: '/my-health-check' },
  { key: 'dt', label: 'My Drive Tests', hint: 'Sites to drive-test', to: '/my-drive-tests' },
]
