// The plan streams, in page order: one PIP per contractor per stream per
// month, and one Internal PIP per stream per month (models/monthly_plan.py
// PLAN_STREAMS). `key` is what the address carries (?stream=ict) and the
// key of the stream in GET /pip/overview; `stream` is the server's code.
// Only DT has an Assignment.
export const PIP_STREAMS = {
  dt: { key: 'dt', stream: 'DT', title: 'DT Delivery', short: 'DT', unit: 'drive tests', example: 'e.g. 40', hasAssignment: true },
  acceptance: {
    key: 'acceptance', stream: 'ACCEPTANCE', title: 'Acceptance', short: 'Acceptance',
    unit: 'villages fully accepted', example: 'e.g. 25', hasAssignment: false,
  },
  ict: { key: 'ict', stream: 'ICT', title: 'ICT', short: 'ICT', unit: 'villages approved by ICT', example: 'e.g. 30', hasAssignment: false },
  cra: { key: 'cra', stream: 'CRA', title: 'CRA', short: 'CRA', unit: 'villages approved by CRA', example: 'e.g. 30', hasAssignment: false },
}

/** Every stream, in page order. */
export const STREAM_LIST = Object.values(PIP_STREAMS)

/** The server's stream codes, in page order: DT, ACCEPTANCE, ICT, CRA. */
export const STREAMS = STREAM_LIST.map((s) => s.stream)

const BY_CODE = Object.fromEntries(STREAM_LIST.map((s) => [s.stream, s]))

/** A stream by its server code, or by its address key, in any case; DT when unknown. */
export function streamMeta(value) {
  const text = String(value ?? '')
  return BY_CODE[text.toUpperCase()] ?? PIP_STREAMS[text.toLowerCase()] ?? PIP_STREAMS.dt
}

/** A revision request's reason, as the PM reads it (services/monthly_plan.py). */
export const REASON_LABEL = {
  SITES_BLOCKED: 'Sites blocked',
  SCOPE_CHANGE: 'Scope change',
  PERMITS: 'Permits',
  OTHER: 'Other',
}
